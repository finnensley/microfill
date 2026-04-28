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

function parseArgs(argv) {
  const options = {
    limit: 10,
    since: null,
    skus: [],
  };

  for (const arg of argv) {
    if (arg.startsWith("--since=")) {
      options.since = arg.slice("--since=".length);
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const parsedLimit = Number.parseInt(arg.slice("--limit=".length), 10);

      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        options.limit = parsedLimit;
      }

      continue;
    }

    options.skus.push(arg);
  }

  return options;
}

function encodeInList(values) {
  return values.map((value) => `"${value}"`).join(",");
}

function getTrackedSkus(cliSkus) {
  if (cliSkus.length > 0) {
    return cliSkus;
  }

  const envSkus = getConfig("SHIPHERO_LIVE_VERIFY_SKUS", "");

  if (envSkus) {
    return envSkus
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return ["SKU-DEMO-BLUE", "SKU-DEMO-RED"];
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

function readNumericField(values, fieldName) {
  if (!values || typeof values !== "object") {
    return null;
  }

  const value = values[fieldName];
  return typeof value === "number" ? value : null;
}

function formatFieldDelta(log, fieldName, label) {
  const previousValue = readNumericField(log.old_values, fieldName);
  const nextValue = readNumericField(log.new_values, fieldName);

  if (previousValue === null && nextValue === null) {
    return null;
  }

  if (previousValue === null) {
    return `${label}=${nextValue}`;
  }

  if (nextValue === null) {
    return `${label}=${previousValue}`;
  }

  const delta = nextValue - previousValue;
  const sign = delta >= 0 ? "+" : "";

  return `${label}=${previousValue} -> ${nextValue} (${sign}${delta})`;
}

const args = parseArgs(process.argv.slice(2));
const supabaseUrl = requireConfig("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireConfig("SUPABASE_SERVICE_ROLE_KEY");
const tenantId = getConfig(
  "WEBHOOK_TENANT_ID",
  getConfig("DEFAULT_TENANT_ID", "10000000-0000-0000-0000-000000000001"),
);
const trackedSkus = getTrackedSkus(args.skus);

const integrationResponse = await supabaseRest(
  `integrations?tenant_id=eq.${encodeURIComponent(tenantId)}&provider=eq.shiphero&select=id,status,display_name,external_account_id,last_synced_at,last_error,updated_at,config&limit=1`,
);
const integrationRows = await integrationResponse.json();
const integration = integrationRows[0] ?? null;

const inventoryResponse = await supabaseRest(
  `inventory_items?tenant_id=eq.${encodeURIComponent(tenantId)}&sku=in.(${encodeInList(trackedSkus)})&select=id,sku,total_quantity,committed_quantity,updated_at&order=sku.asc`,
);
const inventoryItems = await inventoryResponse.json();
const inventoryItemIds = inventoryItems.map((item) => item.id).filter(Boolean);
const itemById = new Map(inventoryItems.map((item) => [item.id, item]));

let auditPath = `audit_logs?tenant_id=eq.${encodeURIComponent(tenantId)}&source=eq.shiphero&select=created_at,action,source,changed_columns,inventory_item_id,new_values,old_values&order=created_at.desc&limit=${args.limit}`;

if (args.since) {
  auditPath += `&created_at=gte.${encodeURIComponent(args.since)}`;
}

if (inventoryItemIds.length > 0) {
  auditPath += `&inventory_item_id=in.(${encodeInList(inventoryItemIds)})`;
}

const auditResponse = await supabaseRest(auditPath);
const auditLogs = await auditResponse.json();

console.log("ShipHero live validation snapshot");
console.log(`Tenant: ${tenantId}`);
console.log(`Tracked SKUs: ${trackedSkus.join(", ")}`);

if (args.since) {
  console.log(`Audit filter since: ${args.since}`);
}

console.log("");

if (!integration) {
  console.log("ShipHero integration: not found for this tenant.");
} else {
  const validationUrl = integration.config?.validation_url;

  console.log("ShipHero integration:");
  console.log(`- Status: ${integration.status}`);
  console.log(`- Display name: ${integration.display_name ?? "n/a"}`);
  console.log(`- Account ID: ${integration.external_account_id ?? "n/a"}`);
  console.log(`- Validation URL: ${validationUrl ?? "n/a"}`);
  console.log(`- Last synced: ${integration.last_synced_at ?? "Never"}`);
  console.log(`- Last error: ${integration.last_error ?? "None"}`);
}

console.log("");

if (inventoryItems.length === 0) {
  console.log("No tracked inventory items were found for this tenant.");
} else {
  console.log("Tracked inventory:");

  for (const item of inventoryItems) {
    console.log(
      `- ${item.sku}: total=${item.total_quantity} committed=${item.committed_quantity} updated_at=${item.updated_at}`,
    );
  }
}

console.log("");

if (auditLogs.length === 0) {
  console.log(
    "No recent ShipHero audit log entries matched the tracked inventory.",
  );
} else {
  console.log("Recent ShipHero audit entries:");

  for (const log of auditLogs) {
    const item = itemById.get(log.inventory_item_id);
    const itemLabel = item?.sku ?? log.inventory_item_id ?? "unknown-item";
    const totalDelta = formatFieldDelta(log, "total_quantity", "total");
    const committedDelta = formatFieldDelta(
      log,
      "committed_quantity",
      "committed",
    );
    const deltaSummary = [totalDelta, committedDelta].filter(Boolean).join(" ");
    const changedColumns = Array.isArray(log.changed_columns)
      ? log.changed_columns.join(",")
      : "";

    console.log(
      `- ${log.created_at} ${itemLabel} action=${log.action} source=${log.source} changed=${changedColumns || "n/a"}${deltaSummary ? ` ${deltaSummary}` : ""}`,
    );
  }
}

console.log("");

if (!integration?.last_synced_at) {
  console.log(
    "Diagnosis: no ShipHero webhook delivery has been recorded for this integration yet. Check the tunnel URL, account ID mapping, and shared secret before retrying.",
  );
} else if (integration.last_error) {
  console.log(
    "Diagnosis: ShipHero reached the webhook route, but the latest delivery logged a problem. Inspect the integration last error above and compare it with the recent audit entries.",
  );
} else {
  console.log(
    "Diagnosis: the latest ShipHero delivery reached the route without a stored integration error. If inventory still looks unchanged, narrow the audit window with --since to isolate the event attempt.",
  );
}
