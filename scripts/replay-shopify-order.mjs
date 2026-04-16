import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const workspaceRoot = process.cwd();
const defaultFixturePath = path.join(
  workspaceRoot,
  "fixtures",
  "shopify",
  "order-created.json",
);
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

function getConfig(name, fallback) {
  return process.env[name] ?? localEnv[name] ?? fallback;
}

const fixturePath = process.argv[2]
  ? path.resolve(workspaceRoot, process.argv[2])
  : defaultFixturePath;
const baseUrl = getConfig("WEBHOOK_BASE_URL", "http://127.0.0.1:3000");
const tenantId = getConfig(
  "WEBHOOK_TENANT_ID",
  getConfig("DEFAULT_TENANT_ID", "10000000-0000-0000-0000-000000000001"),
);
const shopDomain = getConfig(
  "SHOPIFY_TEST_SHOP_DOMAIN",
  "demo-shop.myshopify.com",
);
const shopId = getConfig("SHOPIFY_TEST_SHOP_ID", "demo-shop");
const supabaseUrl = getConfig("NEXT_PUBLIC_SUPABASE_URL", null);
const serviceRoleKey = getConfig("SUPABASE_SERVICE_ROLE_KEY", null);
const webhookSecret = getConfig(
  "SHOPIFY_WEBHOOK_SECRET",
  "replace-for-local-testing",
);

if (!existsSync(fixturePath)) {
  throw new Error(`Fixture not found: ${fixturePath}`);
}

const rawBody = readFileSync(fixturePath, "utf8");
const hmac = crypto
  .createHmac("sha256", webhookSecret)
  .update(rawBody, "utf8")
  .digest("base64");

async function syncReplayIntegration() {
  if (!supabaseUrl || !serviceRoleKey) {
    return false;
  }

  const response = await fetch(
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
          provider: "shopify",
          status: "active",
          display_name: "Local Shopify Replay",
          external_account_id: shopId,
          external_shop_domain: shopDomain,
          webhook_secret: webhookSecret,
          config: {},
        },
      ]),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Unable to sync local Shopify replay integration: ${response.status} ${response.statusText} ${errorBody}`,
    );
  }

  return true;
}

const integrationSynced = await syncReplayIntegration();

const response = await fetch(`${baseUrl}/api/webhooks/shopify`, {
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

const bodyText = await response.text();

console.log(`POST ${baseUrl}/api/webhooks/shopify`);
console.log(`Fixture: ${path.relative(workspaceRoot, fixturePath)}`);
console.log(`Integration synced: ${integrationSynced ? "yes" : "no"}`);
console.log(`Status: ${response.status} ${response.statusText}`);
console.log(bodyText);
