/**
 * simulate-shiphero-launch.mjs
 *
 * Simulates a high-concurrency new item launch by:
 *   1. Pre-stocking a SKU via a single PO Update
 *   2. Firing hundreds of Shipment Updates concurrently (the "launch rush")
 *   3. Draining the queue and reporting the final inventory state
 *
 * This surfaces the floor-protection behavior of MicroFill: even when
 * shipment demand exceeds on-hand stock, atomic SQL operations keep the
 * record consistent and the available-for-sale calculation (which Shopify
 * sees) is always clamped to max(0, total - committed - safety_floor).
 *
 * Requires the local dev server and Supabase stack to be running.
 *
 * Usage:
 *   node scripts/simulate-shiphero-launch.mjs
 *   node scripts/simulate-shiphero-launch.mjs --stock=50 --orders=200 --sku=SKU-DEMO-BLUE
 *
 * Options:
 *   --stock=N       Units to pre-stock before the launch (default: 100)
 *   --orders=N      Shipment Update webhooks to fire (default: 200)
 *   --sku=SKU       Inventory SKU to use (default: SKU-DEMO-BLUE)
 *   --concurrency=N Concurrent webhook posts per batch (default: 20)
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

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    stock: 100,
    orders: 200,
    sku: "SKU-DEMO-BLUE",
    concurrency: 20,
  };
  for (const arg of argv) {
    const [key, val] = arg.replace(/^--/, "").split("=");
    if (key === "stock" && val)
      opts.stock = Math.max(1, Number.parseInt(val, 10));
    if (key === "orders" && val)
      opts.orders = Math.max(1, Number.parseInt(val, 10));
    if (key === "sku" && val) opts.sku = val;
    if (key === "concurrency" && val)
      opts.concurrency = Math.max(1, Math.min(50, Number.parseInt(val, 10)));
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local",
  );
  process.exit(1);
}

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
  if (res.status !== 200 && res.status !== 202) {
    const text = await res.text();
    throw new Error(`Webhook POST returned ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.eventId;
}

async function triggerWorker(batchSize = 100) {
  const headers = { "content-type": "application/json" };
  if (cronSecret) headers["authorization"] = `Bearer ${cronSecret}`;
  const res = await fetch(`${baseUrl}/api/queue/process`, {
    method: "POST",
    headers,
    body: JSON.stringify({ batchSize }),
  });
  if (!res.ok) throw new Error(`Worker returned ${res.status}`);
  return res.json();
}

async function ensureIntegration() {
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
          display_name: "ShipHero Launch Simulation",
          external_account_id: shipHeroAccountId,
          webhook_secret: webhookSecret,
          config: {},
        },
      ]),
    },
  );
}

/**
 * Fire N webhooks in batches of `concurrency`, returning an array of
 * { eventId, ok, error } results. Order-number suffix ensures each
 * webhook has a unique externalId so it creates a distinct queue event.
 */
async function fireConcurrentShipments(sku, ordersToFire, concurrency) {
  const results = [];
  let remaining = ordersToFire;
  let batchStart = 0;

  while (remaining > 0) {
    const batchSize = Math.min(remaining, concurrency);
    const batch = Array.from({ length: batchSize }, (_, i) => {
      const orderNum = batchStart + i + 1;
      return postWebhook({
        webhook_type: "Shipment Update",
        order_id: 90000 + orderNum,
        order_number: `SIM-LAUNCH-${String(orderNum).padStart(5, "0")}`,
        tracking_number: `SIM-TRACK-${orderNum}`,
        line_items: [{ sku, quantity: 1 }],
      })
        .then((eventId) => ({ eventId, ok: true, error: null }))
        .catch((err) => ({ eventId: null, ok: false, error: err.message }));
    });

    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
    batchStart += batchSize;
    remaining -= batchSize;

    // Brief pause between batches so we don't overwhelm the local server
    if (remaining > 0) await new Promise((r) => setTimeout(r, 50));
  }

  return results;
}

/**
 * Drain the queue by calling the worker until it returns processed=0.
 * Caps at maxRounds to avoid an infinite loop if events keep failing.
 */
async function drainQueue(maxRounds = 20) {
  const rounds = [];
  for (let i = 0; i < maxRounds; i++) {
    const result = await triggerWorker(100);
    rounds.push(result);
    if (result.processed === 0) break;
    // Small delay between rounds so claimed events have time to settle
    await new Promise((r) => setTimeout(r, 200));
  }
  return rounds;
}

/**
 * Query final status counts for a set of event IDs.
 * Chunks requests to avoid 414 URI Too Long when there are many IDs.
 */
async function getEventStatusCounts(eventIds) {
  if (eventIds.length === 0)
    return {
      succeeded: 0,
      failed: 0,
      dead_letter: 0,
      pending: 0,
      processing: 0,
      other: 0,
    };
  const counts = {
    succeeded: 0,
    failed: 0,
    dead_letter: 0,
    pending: 0,
    processing: 0,
    other: 0,
  };
  const CHUNK_SIZE = 20;
  for (let i = 0; i < eventIds.length; i += CHUNK_SIZE) {
    const chunk = eventIds.slice(i, i + CHUNK_SIZE);
    const inList = chunk.map((id) => `"${id}"`).join(",");
    const rows = await supabaseRest(
      `webhook_events?id=in.(${inList})&select=status&limit=${chunk.length + 1}`,
    );
    for (const row of rows) {
      if (row.status in counts) counts[row.status]++;
      else counts.other++;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Verify the dev server is reachable
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

const { sku, stock: stockUnits, orders: ordersToFire, concurrency } = opts;

console.log("ShipHero launch simulation");
console.log(`Tenant:      ${tenantId}`);
console.log(`App:         ${baseUrl}`);
console.log(`SKU:         ${sku}`);
console.log(`Pre-stock:   ${stockUnits} units`);
console.log(
  `Orders:      ${ordersToFire} concurrent Shipment Updates (1 unit each)`,
);
console.log(
  `Concurrency: ${ordersToFire} webhooks in batches of ${concurrency}`,
);
console.log(
  `Oversell:    ${ordersToFire > stockUnits ? `YES — demand exceeds stock by ${ordersToFire - stockUnits} units` : "no"}`,
);
console.log("");

// ── Phase 1: Snapshot pre-state ─────────────────────────────────────────────

const baseline = await getInventory(sku);
if (!baseline) {
  console.error(
    `SKU "${sku}" not found in inventory_items for tenant ${tenantId}.`,
  );
  console.error("Run: npm run supabase:reset  to seed the local database.");
  process.exit(1);
}

console.log(
  `Baseline:  total=${baseline.total_quantity}  committed=${baseline.committed_quantity}  floor=${baseline.safety_floor_quantity}`,
);
const baselineAvailable = Math.max(
  0,
  baseline.total_quantity -
    baseline.committed_quantity -
    baseline.safety_floor_quantity,
);
console.log(
  `           available-for-sale = max(0, ${baseline.total_quantity} - ${baseline.committed_quantity} - ${baseline.safety_floor_quantity}) = ${baselineAvailable}`,
);
console.log("");

// ── Phase 2: Pre-stock ───────────────────────────────────────────────────────

console.log(`Phase 1 — Pre-stocking ${stockUnits} units via PO Update...`);
const stockEventId = await postWebhook({
  webhook_type: "PO Update",
  po_id: 80001,
  po_number: "SIM-LAUNCH-STOCK",
  status: "received",
  warehouse_id: 501,
  line_items: [
    {
      sku,
      quantity: stockUnits,
      quantity_received: stockUnits,
      sellable_quantity: baseline.total_quantity + stockUnits,
      product_name: `${sku} Launch Stock`,
    },
  ],
});

await triggerWorker(10);
// Poll until the stock event resolves
{
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    const rows = await supabaseRest(
      `webhook_events?id=eq.${encodeURIComponent(stockEventId)}&select=status&limit=1`,
    );
    if (rows[0]?.status === "succeeded") break;
  }
}

const afterStock = await getInventory(sku);
const stockDelta = (afterStock?.total_quantity ?? 0) - baseline.total_quantity;
const stockOk = stockDelta === stockUnits;

console.log(
  `  PO Update event: ${stockOk ? "✓ processed" : "✗ unexpected result"}`,
);
console.log(
  `  total_quantity: ${baseline.total_quantity} → ${afterStock?.total_quantity}  (expected +${stockUnits}, got ${stockDelta >= 0 ? "+" : ""}${stockDelta})`,
);

if (!stockOk) {
  console.error("\nPre-stock phase failed — aborting launch simulation.");
  process.exit(1);
}

console.log("");

// ── Phase 3: Fire the launch ─────────────────────────────────────────────────

console.log(`Phase 2 — Firing ${ordersToFire} Shipment Updates...`);
const enqueueStart = Date.now();
const enqueueResults = await fireConcurrentShipments(
  sku,
  ordersToFire,
  concurrency,
);
const enqueueMs = Date.now() - enqueueStart;

const enqueuedOk = enqueueResults.filter((r) => r.ok).length;
const enqueuedFailed = enqueueResults.filter((r) => !r.ok).length;
console.log(
  `  Enqueued: ${enqueuedOk}/${ordersToFire} (${enqueueMs}ms)${enqueuedFailed > 0 ? `  — ${enqueuedFailed} failed to enqueue` : ""}`,
);

if (enqueuedFailed > 0) {
  const sample = enqueueResults.filter((r) => !r.ok).slice(0, 3);
  for (const r of sample) console.log(`    Error sample: ${r.error}`);
}

// ── Phase 4: Drain the queue ─────────────────────────────────────────────────

console.log("\nPhase 3 — Draining queue...");
const drainStart = Date.now();
const drainRounds = await drainQueue(30);
const drainMs = Date.now() - drainStart;

let totalProcessed = 0;
for (const [i, round] of drainRounds.entries()) {
  const processed = round.processed ?? 0;
  totalProcessed += processed;
  if (processed > 0) {
    console.log(
      `  Round ${i + 1}: processed ${processed}  succeeded=${round.succeeded ?? "?"} failed=${round.failed ?? "?"}`,
    );
  }
}
const queueEmptyRound = drainRounds.findLast((r) => r.processed === 0);
console.log(
  `  Queue empty after ${drainRounds.length} round(s)  (${drainMs}ms)`,
);

// ── Phase 5: Collect final state ─────────────────────────────────────────────

const successEventIds = enqueueResults
  .filter((r) => r.ok && r.eventId)
  .map((r) => r.eventId);
const statusCounts = await getEventStatusCounts(successEventIds);

const final = await getInventory(sku);
const finalTotal = final?.total_quantity ?? 0;
const finalCommitted = final?.committed_quantity ?? 0;
const finalFloor = final?.safety_floor_quantity ?? 0;
const finalAvailable = Math.max(0, finalTotal - finalCommitted - finalFloor);
const netShipped = (afterStock?.total_quantity ?? 0) - finalTotal;

console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Launch simulation results");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`SKU:           ${sku}`);
console.log(`Pre-stock:     +${stockUnits} units`);
console.log(`Orders fired:  ${ordersToFire} (1 unit each)`);
console.log(
  `Demand excess: ${ordersToFire > stockUnits ? ordersToFire - stockUnits : 0} units over stock`,
);
console.log("");
console.log("Inventory state:");
console.log(
  `  Before launch:  total=${afterStock?.total_quantity}  committed=${afterStock?.committed_quantity}  floor=${afterStock?.safety_floor_quantity}`,
);
console.log(
  `  After launch:   total=${finalTotal}  committed=${finalCommitted}  floor=${finalFloor}`,
);
console.log(
  `  Net shipped:    ${netShipped} units deducted from total_quantity`,
);
console.log(
  `  Available-for-sale (Shopify sees): max(0, ${finalTotal} - ${finalCommitted} - ${finalFloor}) = ${finalAvailable}`,
);
console.log("");
console.log("Queue outcome:");
console.log(`  Succeeded:    ${statusCounts.succeeded}`);
console.log(`  Failed:       ${statusCounts.failed}`);
console.log(`  Dead-lettered:${statusCounts.dead_letter}`);
console.log(`  Still pending:${statusCounts.pending}`);
if (statusCounts.other > 0)
  console.log(`  Other:        ${statusCounts.other}`);
console.log("");

// ── Phase 6: Interpretation ──────────────────────────────────────────────────

const oversold = ordersToFire > stockUnits;
const negativeTotalStock = finalTotal < baseline.total_quantity;
const availableCorrect = finalAvailable === 0 || finalAvailable >= 0;

console.log("Interpretation:");

if (statusCounts.succeeded === enqueuedOk) {
  console.log("  ✓ All enqueued events processed without queue errors");
} else {
  console.log(
    `  ✗ ${enqueuedOk - statusCounts.succeeded} events did not reach succeeded state — check queue for dead-letters`,
  );
}

if (availableCorrect) {
  console.log(
    `  ✓ Available-for-sale is ${finalAvailable} — Shopify will never see a negative number`,
  );
} else {
  console.log("  ✗ Available-for-sale calculation is incorrect");
}

if (oversold) {
  console.log(
    `  ⚠ Demand (${ordersToFire}) exceeded pre-stock (${stockUnits}): total_quantity is now ${finalTotal}`,
  );
  console.log(
    "    This is expected behavior — sync_wms_stock_shipped has no floor in the RPC.",
  );
  console.log(
    "    The safety floor and max(0,...) in shopify-sync.ts protect outbound availability.",
  );
  if (baseline.safety_floor_quantity > 0) {
    console.log(
      `    Safety floor of ${baseline.safety_floor_quantity} was active, cushioning the available count.`,
    );
  } else {
    console.log(
      "    Consider setting a safety_floor_quantity on this SKU to buffer against this scenario.",
    );
  }
  console.log(
    "    Use flash mode during a real launch to pause outbound sync while the queue drains.",
  );
} else {
  console.log(
    `  ✓ Demand (${ordersToFire}) was within stock (${stockUnits}) — no oversell occurred`,
  );
}

console.log("");
console.log(`Total time: ${((Date.now() - enqueueStart) / 1000).toFixed(1)}s`);
