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
const webhookSecret = requireConfig("SHOPIFY_WEBHOOK_SECRET").trim();
const tunnelBaseUrl = normalizeBaseUrl(requireConfig("SHOPIFY_TUNNEL_URL"));

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

console.log("Shopify live smoke test");
console.log(`Tenant: ${tenantId}`);
console.log(`Shop domain: ${shopDomain}`);
console.log(`Shop ID: ${shopId}`);
console.log(`Webhook URL: ${tunnelBaseUrl}/api/webhooks/shopify`);
console.log(`Status: ${response.status} ${response.statusText}`);
console.log("Response:");
console.log(responseBody);

if (!response.ok) {
  throw new Error(
    `Smoke test failed: ${response.status} ${response.statusText}`,
  );
}
