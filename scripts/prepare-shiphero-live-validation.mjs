import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const envFilePath = path.join(workspaceRoot, ".env.local");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const contents = readFileSync(filePath, "utf8");
  const env = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

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

const localEnv = parseEnvFile(envFilePath);

function getConfig(name, fallback = null) {
  return process.env[name] ?? localEnv[name] ?? fallback;
}

function requireConfig(name, hint = null) {
  const value = getConfig(name);

  if (!value) {
    throw new Error(
      hint
        ? `Missing required config: ${name}. ${hint}`
        : `Missing required config: ${name}`,
    );
  }

  return value;
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function getTrackedSkus() {
  const configuredSkus = getConfig(
    "SHIPHERO_LIVE_TRACKED_SKUS",
    "SKU-DEMO-BLUE,SKU-DEMO-RED",
  );

  return configuredSkus
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function encodeInList(values) {
  return values.map((value) => `"${value}"`).join(",");
}

async function supabaseRest(pathname, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Supabase request failed: ${response.status} ${response.statusText} ${errorBody}`,
    );
  }

  return response;
}

const supabaseUrl = requireConfig("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireConfig("SUPABASE_SERVICE_ROLE_KEY");
const tenantId = getConfig(
  "WEBHOOK_TENANT_ID",
  getConfig("DEFAULT_TENANT_ID", "10000000-0000-0000-0000-000000000001"),
);
const tunnelBaseUrl = normalizeBaseUrl(requireConfig("SHIPHERO_TUNNEL_URL"));
const webhookSecret = requireConfig(
  "SHIPHERO_WEBHOOK_SECRET",
  "Set it in .env.local or export it before configuring the ShipHero webhook.",
).trim();
const shipHeroAccountId = requireConfig(
  "SHIPHERO_LIVE_ACCOUNT_ID",
  "Set the ShipHero warehouse or account identifier that the live webhook source will send.",
).trim();
const trackedSkus = getTrackedSkus();

await supabaseRest("integrations?on_conflict=tenant_id,provider", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify([
    {
      tenant_id: tenantId,
      provider: "shiphero",
      status: "active",
      display_name: "Live ShipHero Validation",
      external_account_id: shipHeroAccountId,
      webhook_secret: webhookSecret,
      config: {
        validation_mode: "live_shiphero_tunnel",
        validation_url: `${tunnelBaseUrl}/api/webhooks/shiphero`,
      },
    },
  ]),
});

const inventoryResponse = await supabaseRest(
  `inventory_items?tenant_id=eq.${encodeURIComponent(tenantId)}&sku=in.(${encodeInList(trackedSkus)})&select=sku,total_quantity,committed_quantity,updated_at&order=sku.asc`,
);
const inventoryItems = await inventoryResponse.json();

console.log("Live ShipHero validation is prepared.");
console.log(`Tenant: ${tenantId}`);
console.log(`ShipHero account ID: ${shipHeroAccountId}`);
console.log(`Webhook URL: ${tunnelBaseUrl}/api/webhooks/shiphero`);
console.log(`Tracked SKUs: ${trackedSkus.join(", ")}`);
console.log("");
console.log("ShipHero setup:");
console.log(
  `1. Create or update the ShipHero webhook destination to ${tunnelBaseUrl}/api/webhooks/shiphero`,
);
console.log(
  "2. Configure the webhook secret to match SHIPHERO_WEBHOOK_SECRET in .env.local.",
);
console.log(
  `3. Confirm the live source sends x-shiphero-account-id=${shipHeroAccountId} or update SHIPHERO_LIVE_ACCOUNT_ID to match the provider value.`,
);
console.log(
  `4. Trigger a live PO Update or Shipment Update that references one of: ${trackedSkus.join(", ")}.`,
);
console.log(
  "5. Verify the resulting inventory and audit-log changes with the command below.",
);
console.log("");
console.log("Suggested verification command:");
console.log("npm run webhook:shiphero:live:verify");
console.log("");

if (inventoryItems.length === 0) {
  console.log("No tracked inventory items were found for this tenant.");
} else {
  console.log("Tracked inventory snapshot:");

  for (const item of inventoryItems) {
    console.log(
      `- ${item.sku}: total=${item.total_quantity} committed=${item.committed_quantity} updated_at=${item.updated_at}`,
    );
  }
}
