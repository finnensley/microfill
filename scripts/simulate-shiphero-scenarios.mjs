/**
 * simulate-shiphero-scenarios.mjs
 *
 * Runs named ShipHero webhook scenarios against the local app, asserts the
 * expected inventory state after each one, and reports pass/fail.
 *
 * Requires the local dev server and Supabase stack to be running.
 *
 * Usage:
 *   node scripts/simulate-shiphero-scenarios.mjs           # run all scenarios
 *   node scripts/simulate-shiphero-scenarios.mjs receive-stock ship-order
 *
 * Options read from .env.local (or process.env):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   SHIPHERO_WEBHOOK_SECRET, CRON_SECRET
 *   WEBHOOK_BASE_URL (default http://127.0.0.1:3000)
 *   DEFAULT_TENANT_ID / WEBHOOK_TENANT_ID
 */

import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const workspaceRoot = process.cwd();

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const env = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim();
    let value = trimmed.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const localEnv = parseEnvFile(path.join(workspaceRoot, ".env.local"));

function getConfig(name, fallback = null) {
  return process.env[name] ?? localEnv[name] ?? fallback;
}

const baseUrl = getConfig("WEBHOOK_BASE_URL", "http://127.0.0.1:3000");
const tenantId = getConfig(
  "WEBHOOK_TENANT_ID",
  getConfig("DEFAULT_TENANT_ID", "10000000-0000-0000-0000-000000000001"),
);
const webhookSecret = getConfig(
  "SHIPHERO_WEBHOOK_SECRET",
  "replace-for-local-testing",
);
const cronSecret = getConfig("CRON_SECRET", null);
const supabaseUrl = getConfig("NEXT_PUBLIC_SUPABASE_URL", null);
const serviceRoleKey = getConfig("SUPABASE_SERVICE_ROLE_KEY", null);
const shipHeroAccountId = getConfig(
  "SHIPHERO_TEST_ACCOUNT_ID",
  "demo-shiphero-account",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sign(body) {
  return crypto
    .createHmac("sha256", webhookSecret)
    .update(body, "utf8")
    .digest("base64");
}

async function supabaseRest(pathname, options = {}) {
  if (!supabaseUrl || !serviceRoleKey)
    throw new Error("Supabase credentials not set");
  const res = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase REST ${pathname}: ${res.status} ${text}`);
  }
  return res.json();
}

async function getInventory(sku) {
  const rows = await supabaseRest(
    `inventory_items?tenant_id=eq.${encodeURIComponent(tenantId)}&sku=eq.${encodeURIComponent(sku)}&select=id,sku,total_quantity,committed_quantity,safety_floor_quantity`,
  );
  return rows[0] ?? null;
}

async function postWebhook(payload) {
  const body = JSON.stringify(payload);
  const hmac = sign(body);
  const res = await fetch(`${baseUrl}/api/webhooks/shiphero`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shiphero-hmac-sha256": hmac,
      "x-shiphero-account-id": shipHeroAccountId,
      "x-tenant-id": tenantId,
    },
    body,
  });
  const text = await res.text();
  if (res.status !== 200 && res.status !== 202)
    throw new Error(`Webhook POST returned ${res.status}: ${text}`);
  const json = JSON.parse(text);
  return json.eventId;
}

async function triggerWorker(batchSize = 10) {
  const headers = { "content-type": "application/json" };
  if (cronSecret) headers["authorization"] = `Bearer ${cronSecret}`;
  const res = await fetch(`${baseUrl}/api/queue/process`, {
    method: "POST",
    headers,
    body: JSON.stringify({ batchSize }),
  });
  if (!res.ok && res.status !== 200) {
    throw new Error(`Worker returned ${res.status}`);
  }
  return res.json();
}

async function pollEventStatus(eventId, timeoutMs = 12000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const rows = await supabaseRest(
      `webhook_events?id=eq.${encodeURIComponent(eventId)}&select=status,attempts,last_error&limit=1`,
    );
    const event = rows[0];
    if (
      event &&
      (event.status === "succeeded" ||
        event.status === "failed" ||
        event.status === "dead_letter")
    ) {
      return event;
    }
  }
  return { status: "timeout", attempts: null, error: "poll timed out" };
}

async function ensureIntegration() {
  if (!supabaseUrl || !serviceRoleKey) return;
  await fetch(
    `${supabaseUrl}/rest/v1/integrations?on_conflict=tenant_id,provider`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        {
          tenant_id: tenantId,
          provider: "shiphero",
          status: "active",
          display_name: "ShipHero Scenario Runner",
          external_account_id: shipHeroAccountId,
          webhook_secret: webhookSecret,
          config: {},
        },
      ]),
    },
  );
}

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

/**
 * Each scenario returns { pass: boolean, detail: string }.
 * pre/post are inventory snapshots: { total_quantity, committed_quantity }.
 */

const SCENARIOS = {
  "receive-stock": {
    description: "PO Update — 7 units received for SKU-DEMO-BLUE",
    sku: "SKU-DEMO-BLUE",
    async run() {
      const pre = await getInventory("SKU-DEMO-BLUE");
      const eventId = await postWebhook({
        webhook_type: "PO Update",
        po_id: 9001,
        po_number: "SIM-PO-9001",
        status: "partially_received",
        warehouse_id: 501,
        line_items: [
          {
            sku: "SKU-DEMO-BLUE",
            quantity: 20,
            quantity_received: 7,
            sellable_quantity: (pre?.total_quantity ?? 0) + 7,
            product_name: "Demo Blue Bottle",
          },
        ],
      });
      await triggerWorker();
      const event = await pollEventStatus(eventId);
      const post = await getInventory("SKU-DEMO-BLUE");
      const delta = (post?.total_quantity ?? 0) - (pre?.total_quantity ?? 0);
      const pass = event.status === "succeeded" && delta === 7;
      return {
        pass,
        detail: `event=${event.status}  total_quantity ${pre?.total_quantity} → ${post?.total_quantity} (delta ${delta >= 0 ? "+" : ""}${delta}, expected +7)`,
      };
    },
  },

  "ship-order": {
    description: "Shipment Update — 3 units shipped for SKU-DEMO-RED",
    sku: "SKU-DEMO-RED",
    async run() {
      const pre = await getInventory("SKU-DEMO-RED");
      const eventId = await postWebhook({
        webhook_type: "Shipment Update",
        order_id: 9002,
        order_number: "SIM-ORDER-9002",
        tracking_number: "SIM-TRACK-9002",
        line_items: [{ sku: "SKU-DEMO-RED", quantity: 3 }],
      });
      await triggerWorker();
      const event = await pollEventStatus(eventId);
      const post = await getInventory("SKU-DEMO-RED");
      const delta = (post?.total_quantity ?? 0) - (pre?.total_quantity ?? 0);
      const pass = event.status === "succeeded" && delta === -3;
      return {
        pass,
        detail: `event=${event.status}  total_quantity ${pre?.total_quantity} → ${post?.total_quantity} (delta ${delta >= 0 ? "+" : ""}${delta}, expected -3)`,
      };
    },
  },

  "partial-receipt": {
    description: "PO Update — 5 of 30 units received (partial shipment)",
    sku: "SKU-DEMO-BLUE",
    async run() {
      const pre = await getInventory("SKU-DEMO-BLUE");
      const eventId = await postWebhook({
        webhook_type: "PO Update",
        po_id: 9003,
        po_number: "SIM-PO-9003",
        status: "partially_received",
        warehouse_id: 501,
        line_items: [
          {
            sku: "SKU-DEMO-BLUE",
            quantity: 30,
            quantity_received: 5,
            sellable_quantity: (pre?.total_quantity ?? 0) + 5,
            product_name: "Demo Blue Bottle",
          },
        ],
      });
      await triggerWorker();
      const event = await pollEventStatus(eventId);
      const post = await getInventory("SKU-DEMO-BLUE");
      const delta = (post?.total_quantity ?? 0) - (pre?.total_quantity ?? 0);
      // Only quantity_received is used by the adapter, not quantity
      const pass = event.status === "succeeded" && delta === 5;
      return {
        pass,
        detail: `event=${event.status}  total_quantity ${pre?.total_quantity} → ${post?.total_quantity} (delta ${delta >= 0 ? "+" : ""}${delta}, expected +5 from qty_received=5 of qty_ordered=30)`,
      };
    },
  },

  "multi-sku": {
    description: "PO Update — two SKUs in one event (BLUE +10, RED +8)",
    async run() {
      const preBlue = await getInventory("SKU-DEMO-BLUE");
      const preRed = await getInventory("SKU-DEMO-RED");
      const eventId = await postWebhook({
        webhook_type: "PO Update",
        po_id: 9004,
        po_number: "SIM-PO-9004",
        status: "received",
        warehouse_id: 501,
        line_items: [
          {
            sku: "SKU-DEMO-BLUE",
            quantity: 10,
            quantity_received: 10,
            sellable_quantity: (preBlue?.total_quantity ?? 0) + 10,
            product_name: "Demo Blue Bottle",
          },
          {
            sku: "SKU-DEMO-RED",
            quantity: 8,
            quantity_received: 8,
            sellable_quantity: (preRed?.total_quantity ?? 0) + 8,
            product_name: "Demo Red Bottle",
          },
        ],
      });
      await triggerWorker();
      const event = await pollEventStatus(eventId);
      const postBlue = await getInventory("SKU-DEMO-BLUE");
      const postRed = await getInventory("SKU-DEMO-RED");
      const deltaBlue =
        (postBlue?.total_quantity ?? 0) - (preBlue?.total_quantity ?? 0);
      const deltaRed =
        (postRed?.total_quantity ?? 0) - (preRed?.total_quantity ?? 0);
      const pass =
        event.status === "succeeded" && deltaBlue === 10 && deltaRed === 8;
      return {
        pass,
        detail: `event=${event.status}  BLUE ${preBlue?.total_quantity} → ${postBlue?.total_quantity} (+${deltaBlue}, expected +10)  RED ${preRed?.total_quantity} → ${postRed?.total_quantity} (+${deltaRed}, expected +8)`,
      };
    },
  },

  "zero-quantity": {
    description: "PO Update — quantity_received=0 (no-op, inventory unchanged)",
    sku: "SKU-DEMO-BLUE",
    async run() {
      const pre = await getInventory("SKU-DEMO-BLUE");
      const eventId = await postWebhook({
        webhook_type: "PO Update",
        po_id: 9005,
        po_number: "SIM-PO-9005",
        status: "pending",
        warehouse_id: 501,
        line_items: [
          {
            sku: "SKU-DEMO-BLUE",
            quantity: 50,
            quantity_received: 0,
            sellable_quantity: pre?.total_quantity ?? 0,
            product_name: "Demo Blue Bottle",
          },
        ],
      });
      await triggerWorker();
      const event = await pollEventStatus(eventId);
      const post = await getInventory("SKU-DEMO-BLUE");
      const delta = (post?.total_quantity ?? 0) - (pre?.total_quantity ?? 0);
      const pass = event.status === "succeeded" && delta === 0;
      return {
        pass,
        detail: `event=${event.status}  total_quantity ${pre?.total_quantity} → ${post?.total_quantity} (delta ${delta}, expected 0)`,
      };
    },
  },

  "unknown-sku": {
    description:
      "PO Update — SKU that does not exist in inventory_items (graceful no-op)",
    async run() {
      const eventId = await postWebhook({
        webhook_type: "PO Update",
        po_id: 9006,
        po_number: "SIM-PO-9006",
        status: "received",
        warehouse_id: 501,
        line_items: [
          {
            sku: "SKU-DOES-NOT-EXIST",
            quantity: 5,
            quantity_received: 5,
            sellable_quantity: 5,
            product_name: "Ghost Item",
          },
        ],
      });
      await triggerWorker();
      const event = await pollEventStatus(eventId);
      // The RPC runs UPDATE ... WHERE sku = '...' — no row matched, no error thrown.
      // The event should succeed (the adapter and RPC both treat 0-row updates as non-fatal).
      const pass = event.status === "succeeded";
      return {
        pass,
        detail: `event=${event.status} (expected succeeded — unknown SKU is a no-op, not an error)${event.error ? `  error="${event.error}"` : ""}`,
      };
    },
  },
};

const ALL_NAMES = Object.keys(SCENARIOS);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const requestedNames = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const scenarioNames = requestedNames.length > 0 ? requestedNames : ALL_NAMES;

const unknown = scenarioNames.filter((n) => !SCENARIOS[n]);
if (unknown.length > 0) {
  console.error(`Unknown scenario(s): ${unknown.join(", ")}`);
  console.error(`Available: ${ALL_NAMES.join(", ")}`);
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local",
  );
  process.exit(1);
}

// Verify the dev server is reachable before starting
try {
  const health = await fetch(`${baseUrl}/api/health`);
  if (!health.ok) throw new Error(`health check returned ${health.status}`);
} catch (err) {
  console.error(
    `App is not reachable at ${baseUrl} — start it with: npm run dev`,
  );
  console.error(err.message);
  process.exit(1);
}

await ensureIntegration();

console.log("ShipHero scenario runner");
console.log(`Tenant: ${tenantId}`);
console.log(`App:    ${baseUrl}`);
console.log(`Scenarios: ${scenarioNames.join(", ")}`);
console.log("");

let passed = 0;
let failed = 0;

for (const name of scenarioNames) {
  const scenario = SCENARIOS[name];
  process.stdout.write(`SCENARIO: ${name}\n  ${scenario.description}\n`);
  try {
    const result = await scenario.run();
    const badge = result.pass ? "✓ PASS" : "✗ FAIL";
    console.log(`  ${badge}  ${result.detail}`);
    if (result.pass) passed++;
    else failed++;
  } catch (err) {
    console.log(`  ✗ ERROR  ${err.message}`);
    failed++;
  }
  console.log("");
}

console.log(
  `Results: ${passed}/${scenarioNames.length} passed${failed > 0 ? `  (${failed} failed)` : ""}`,
);
process.exit(failed > 0 ? 1 : 0);
