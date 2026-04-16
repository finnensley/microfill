import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const workspaceRoot = process.cwd();
const envFilePath = path.join(workspaceRoot, ".env.local");
const fixturePath = path.join(
  workspaceRoot,
  "fixtures",
  "shopify",
  "order-created.json",
);

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
    const message = hint
      ? `Missing required config: ${name}. ${hint}`
      : `Missing required config: ${name}`;

    throw new Error(message);
  }

  return value;
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function parseBoolean(value) {
  return value === "1" || value === "true" || value === "yes";
}

function buildInventoryOverride(label, defaultSku) {
  const normalizedLabel = label.toUpperCase();
  const sku = getConfig(`SHOPIFY_LIVE_SKU_${normalizedLabel}`, defaultSku);
  const productId = getConfig(`SHOPIFY_LIVE_PRODUCT_${normalizedLabel}_ID`);
  const variantId = getConfig(`SHOPIFY_LIVE_VARIANT_${normalizedLabel}_ID`);

  if (!productId && !variantId) {
    return null;
  }

  if (!productId || !variantId) {
    throw new Error(
      `Both SHOPIFY_LIVE_PRODUCT_${normalizedLabel}_ID and SHOPIFY_LIVE_VARIANT_${normalizedLabel}_ID are required when overriding live inventory mappings.`,
    );
  }

  return {
    label: normalizedLabel,
    productId: productId.trim(),
    sku,
    variantId: variantId.trim(),
  };
}

const supabaseUrl = requireConfig("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireConfig("SUPABASE_SERVICE_ROLE_KEY");
const tenantId = getConfig(
  "WEBHOOK_TENANT_ID",
  getConfig("DEFAULT_TENANT_ID", "10000000-0000-0000-0000-000000000001"),
);
const shopDomain = requireConfig("SHOPIFY_LIVE_SHOP_DOMAIN")
  .trim()
  .toLowerCase();
const shopId = getConfig(
  "SHOPIFY_LIVE_SHOP_ID",
  shopDomain.replace(/\.myshopify\.com$/, ""),
);
const webhookSecret = requireConfig(
  "SHOPIFY_WEBHOOK_SECRET",
  "Set it in .env.local or export it for this command before configuring the Shopify webhook.",
).trim();
const tunnelBaseUrl = normalizeBaseUrl(requireConfig("SHOPIFY_TUNNEL_URL"));
const webhookTopic = getConfig("SHOPIFY_LIVE_WEBHOOK_TOPIC", "orders/create");
const shouldSmokeTest = parseBoolean(
  getConfig("SHOPIFY_LIVE_SMOKE_TEST", "false").toLowerCase(),
);
const inventoryOverrides = [
  buildInventoryOverride("blue", "SKU-DEMO-BLUE"),
  buildInventoryOverride("red", "SKU-DEMO-RED"),
].filter(Boolean);

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

async function syncLiveIntegration() {
  await supabaseRest("integrations?on_conflict=tenant_id,provider", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([
      {
        tenant_id: tenantId,
        provider: "shopify",
        status: "active",
        display_name: "Live Shopify Validation",
        external_account_id: shopId,
        external_shop_domain: shopDomain,
        webhook_secret: webhookSecret,
        config: {
          validation_mode: "live_shopify_tunnel",
          validation_topic: webhookTopic,
          validation_url: `${tunnelBaseUrl}/api/webhooks/shopify`,
        },
      },
    ]),
  });
}

async function syncLiveInventoryMappings() {
  const syncedOverrides = [];

  for (const override of inventoryOverrides) {
    await supabaseRest(
      `inventory_items?tenant_id=eq.${encodeURIComponent(tenantId)}&sku=eq.${encodeURIComponent(override.sku)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          prefer: "return=minimal",
        },
        body: JSON.stringify({
          shopify_product_id: override.productId,
          shopify_variant_id: override.variantId,
        }),
      },
    );

    syncedOverrides.push(override);
  }

  return syncedOverrides;
}

async function fetchTenantInventoryMappings() {
  const response = await supabaseRest(
    `inventory_items?tenant_id=eq.${encodeURIComponent(tenantId)}&select=sku,shopify_product_id,shopify_variant_id&order=sku.asc`,
  );

  return response.json();
}

async function runSmokeTest() {
  if (!existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixturePath}`);
  }

  const rawBody = readFileSync(fixturePath, "utf8");
  const hmac = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody, "utf8")
    .digest("base64");

  const response = await fetch(`${tunnelBaseUrl}/api/webhooks/shopify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-shop-domain": shopDomain,
      "x-shopify-shop-id": shopId,
      "x-tenant-id": tenantId,
    },
    body: rawBody,
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Smoke test failed: ${response.status} ${response.statusText} ${responseBody}`,
    );
  }

  return responseBody;
}

await syncLiveIntegration();
const syncedOverrides = await syncLiveInventoryMappings();
const inventoryMappings = await fetchTenantInventoryMappings();

console.log("Live Shopify validation is prepared.");
console.log(`Tenant: ${tenantId}`);
console.log(`Shop domain: ${shopDomain}`);
console.log(`Shop ID: ${shopId}`);
console.log(`Topic: ${webhookTopic}`);
console.log(`Webhook URL: ${tunnelBaseUrl}/api/webhooks/shopify`);
console.log("");

if (syncedOverrides.length > 0) {
  console.log("Applied live Shopify ID overrides:");

  for (const override of syncedOverrides) {
    console.log(
      `- ${override.sku}: product=${override.productId} variant=${override.variantId}`,
    );
  }

  console.log("");
} else {
  console.log(
    "No real Shopify product/variant ID overrides are configured yet. Real orders will only be processed if the store variant IDs already match the local inventory mappings below.",
  );
  console.log("");
}

console.log("Seeded inventory mappings for a live order:");

for (const item of inventoryMappings) {
  console.log(
    `- ${item.sku}: product=${item.shopify_product_id} variant=${item.shopify_variant_id}`,
  );
}

console.log("");
console.log("Shopify admin setup:");
console.log(
  `1. Create or update an '${webhookTopic}' webhook in Shopify admin.`,
);
console.log(
  `2. Set the destination URL to ${tunnelBaseUrl}/api/webhooks/shopify`,
);
console.log(
  "3. Set the webhook secret to match SHOPIFY_WEBHOOK_SECRET in .env.local.",
);
console.log(
  "4. Submit a test order that includes one of the variant IDs listed above.",
);
console.log(
  "5. Confirm the resulting committed inventory change in the dashboard and audit history.",
);
console.log("");
console.log("Suggested verification SQL:");
console.log(
  `PGPASSWORD=postgres psql \"postgresql://postgres@127.0.0.1:54321/postgres\" -c \"select sku, total_quantity, committed_quantity, updated_at from public.inventory_items where tenant_id = '${tenantId}' order by sku;\"`,
);
console.log(
  `PGPASSWORD=postgres psql \"postgresql://postgres@127.0.0.1:54321/postgres\" -c \"select created_at, action, source, changed_columns from public.audit_logs where tenant_id = '${tenantId}' order by created_at desc limit 10;\"`,
);

if (shouldSmokeTest) {
  console.log("");
  const smokeTestBody = await runSmokeTest();
  console.log("Tunnel smoke test succeeded.");
  console.log(smokeTestBody);
}
