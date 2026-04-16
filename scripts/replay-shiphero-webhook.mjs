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

function getConfig(name, fallback) {
  return process.env[name] ?? localEnv[name] ?? fallback;
}

const fixtureArg = process.argv[2];

if (!fixtureArg) {
  throw new Error(
    "Usage: node scripts/replay-shiphero-webhook.mjs <fixture-path>",
  );
}

const fixturePath = path.resolve(workspaceRoot, fixtureArg);
const baseUrl = getConfig("WEBHOOK_BASE_URL", "http://127.0.0.1:3000");
const tenantId = getConfig(
  "WEBHOOK_TENANT_ID",
  getConfig("DEFAULT_TENANT_ID", "10000000-0000-0000-0000-000000000001"),
);
const shipHeroAccountId = getConfig(
  "SHIPHERO_TEST_ACCOUNT_ID",
  "demo-shiphero-account",
);
const supabaseUrl = getConfig("NEXT_PUBLIC_SUPABASE_URL", null);
const serviceRoleKey = getConfig("SUPABASE_SERVICE_ROLE_KEY", null);
const webhookSecret = getConfig(
  "SHIPHERO_WEBHOOK_SECRET",
  "replace-for-local-testing",
);

if (!existsSync(fixturePath)) {
  throw new Error(`Fixture not found: ${fixturePath}`);
}

const rawBody = readFileSync(fixturePath, "utf8");
const parsedBody = JSON.parse(rawBody);
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
          provider: "shiphero",
          status: "active",
          display_name: "Local ShipHero Replay",
          external_account_id: shipHeroAccountId,
          webhook_secret: webhookSecret,
          config: {},
        },
      ]),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Unable to sync local ShipHero replay integration: ${response.status} ${response.statusText} ${errorBody}`,
    );
  }

  return true;
}

const integrationSynced = await syncReplayIntegration();

const response = await fetch(`${baseUrl}/api/webhooks/shiphero`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-shiphero-webhook-signature": hmac,
    "x-shiphero-account-id": shipHeroAccountId,
    "x-tenant-id": tenantId,
  },
  body: rawBody,
});

const bodyText = await response.text();

console.log(`POST ${baseUrl}/api/webhooks/shiphero`);
console.log(`Fixture: ${path.relative(workspaceRoot, fixturePath)}`);
console.log(`Webhook type: ${parsedBody.webhook_type ?? "unknown"}`);
console.log(`Integration synced: ${integrationSynced ? "yes" : "no"}`);
console.log(`Status: ${response.status} ${response.statusText}`);
console.log(bodyText);
