import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";
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

function resolveFixturePath(selection) {
  if (selection === "po") {
    return path.join(workspaceRoot, "fixtures", "shiphero", "po-update.json");
  }

  if (selection === "shipment") {
    return path.join(
      workspaceRoot,
      "fixtures",
      "shiphero",
      "shipment-update.json",
    );
  }

  return path.resolve(workspaceRoot, selection);
}

const fixtureSelection = getConfig("SHIPHERO_LIVE_SMOKE_FIXTURE", "shipment");
const fixturePath = resolveFixturePath(fixtureSelection);
const tenantId = getConfig(
  "WEBHOOK_TENANT_ID",
  getConfig("DEFAULT_TENANT_ID", "10000000-0000-0000-0000-000000000001"),
);
const tunnelBaseUrl = normalizeBaseUrl(requireConfig("SHIPHERO_TUNNEL_URL"));
const webhookSecret = requireConfig("SHIPHERO_WEBHOOK_SECRET").trim();
const shipHeroAccountId = requireConfig("SHIPHERO_LIVE_ACCOUNT_ID").trim();

if (!existsSync(fixturePath)) {
  throw new Error(`Fixture not found: ${fixturePath}`);
}

const rawBody = readFileSync(fixturePath, "utf8");
const parsedBody = JSON.parse(rawBody);
const hmac = crypto
  .createHmac("sha256", webhookSecret)
  .update(rawBody, "utf8")
  .digest("base64");

const response = await fetch(`${tunnelBaseUrl}/api/webhooks/shiphero`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-shiphero-webhook-signature": hmac,
    "x-shiphero-account-id": shipHeroAccountId,
    "x-tenant-id": tenantId,
  },
  body: rawBody,
});

const responseBody = await response.text();

console.log("ShipHero live smoke test");
console.log(`Tenant: ${tenantId}`);
console.log(`ShipHero account ID: ${shipHeroAccountId}`);
console.log(`Webhook URL: ${tunnelBaseUrl}/api/webhooks/shiphero`);
console.log(`Fixture: ${path.relative(workspaceRoot, fixturePath)}`);
console.log(`Webhook type: ${parsedBody.webhook_type ?? "unknown"}`);
console.log(`Status: ${response.status} ${response.statusText}`);
console.log("Response:");
console.log(responseBody);

if (!response.ok) {
  throw new Error(
    `Smoke test failed: ${response.status} ${response.statusText}`,
  );
}
