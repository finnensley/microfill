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

  const envSkus = getConfig("SHOPIFY_LIVE_VERIFY_SKUS", "");

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

function readCommittedQuantity(values) {
  if (!values || typeof values !== "object") {
    return null;
  }

  const committedQuantity = values.committed_quantity;

  return typeof committedQuantity === "number" ? committedQuantity : null;
}

function formatCommittedDelta(log) {
  const previousValue = readCommittedQuantity(log.old_values);
  const nextValue = readCommittedQuantity(log.new_values);

  if (previousValue === null && nextValue === null) {
    return null;
  }

  if (previousValue === null) {
    return `${nextValue}`;
  }

  if (nextValue === null) {
    return `${previousValue}`;
  }

  const delta = nextValue - previousValue;
  const sign = delta >= 0 ? "+" : "";

  return `${previousValue} -> ${nextValue} (${sign}${delta})`;
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
  `integrations?tenant_id=eq.${encodeURIComponent(tenantId)}&provider=eq.shopify&select=id,status,display_name,external_account_id,external_shop_domain,last_synced_at,last_error,updated_at,config&limit=1`,
);
const integrationRows = await integrationResponse.json();
const integration = integrationRows[0] ?? null;

const inventoryResponse = await supabaseRest(
  `inventory_items?tenant_id=eq.${encodeURIComponent(tenantId)}&sku=in.(${encodeInList(trackedSkus)})&select=id,sku,shopify_product_id,shopify_variant_id,total_quantity,committed_quantity,updated_at&order=sku.asc`,
);
const inventoryItems = await inventoryResponse.json();
const inventoryItemIds = inventoryItems.map((item) => item.id).filter(Boolean);

let auditPath = `audit_logs?tenant_id=eq.${encodeURIComponent(tenantId)}&select=created_at,action,source,changed_columns,inventory_item_id,new_values,old_values&order=created_at.desc&limit=${args.limit}`;

if (args.since) {
  auditPath += `&created_at=gte.${encodeURIComponent(args.since)}`;
}

if (inventoryItemIds.length > 0) {
  auditPath += `&inventory_item_id=in.(${encodeInList(inventoryItemIds)})`;
}

const auditResponse = await supabaseRest(auditPath);
const auditLogs = await auditResponse.json();
const itemById = new Map(inventoryItems.map((item) => [item.id, item]));

console.log("Shopify live validation snapshot");
console.log(`Tenant: ${tenantId}`);
console.log(`Tracked SKUs: ${trackedSkus.join(", ")}`);

if (args.since) {
  console.log(`Audit filter since: ${args.since}`);
}

console.log("");

if (!integration) {
  console.log("Shopify integration: not found for this tenant.");
} else {
  const validationUrl = integration.config?.validation_url;

  console.log("Shopify integration:");
  console.log(`- Status: ${integration.status}`);
  console.log(`- Display name: ${integration.display_name ?? "n/a"}`);
  console.log(`- Shop domain: ${integration.external_shop_domain ?? "n/a"}`);
  console.log(`- Shop account ID: ${integration.external_account_id ?? "n/a"}`);
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
      `- ${item.sku}: product=${item.shopify_product_id} variant=${item.shopify_variant_id} total=${item.total_quantity} committed=${item.committed_quantity} updated_at=${item.updated_at}`,
    );
  }
}

console.log("");

if (auditLogs.length === 0) {
  console.log("No recent audit log entries matched the tracked inventory.");
} else {
  console.log("Recent audit entries:");

  for (const log of auditLogs) {
    const item = itemById.get(log.inventory_item_id);
    const itemLabel = item?.sku ?? log.inventory_item_id ?? "unknown-item";
    const committedDelta = formatCommittedDelta(log);
    const changedColumns = Array.isArray(log.changed_columns)
      ? log.changed_columns.join(",")
      : "";

    console.log(
      `- ${log.created_at} ${itemLabel} action=${log.action} source=${log.source} changed=${changedColumns || "n/a"}${committedDelta ? ` committed=${committedDelta}` : ""}`,
    );
  }
}

console.log("");

if (!integration?.last_synced_at) {
  console.log(
    "Diagnosis: no Shopify webhook delivery has been recorded for this integration yet. Check the Shopify webhook destination URL, secret, and tunnel health.",
  );
} else if (integration.last_error) {
  console.log(
    "Diagnosis: Shopify reached the webhook route, but the latest delivery did not fully apply to tracked inventory. Inspect the integration last error above for skipped variant IDs or signature issues.",
  );
} else {
  console.log(
    "Diagnosis: the latest Shopify delivery reached the route without a stored integration error. If inventory is still unchanged, narrow the audit window with --since to isolate the order attempt.",
  );
}
