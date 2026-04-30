/**
 * verify-shopify-outbound-sync.mjs
 *
 * Validates the configuration required for outbound Shopify inventory sync and
 * optionally applies credentials to the tenant's Shopify integration record.
 *
 * Usage:
 *   node scripts/verify-shopify-outbound-sync.mjs [options] [SKU ...]
 *
 * Options:
 *   --apply          Write SHOPIFY_OUTBOUND_ACCESS_TOKEN and
 *                    SHOPIFY_OUTBOUND_LOCATION_ID from .env.local into the
 *                    integration record via the Supabase service role. Safe to
 *                    run multiple times (idempotent PATCH).
 *   --dry-run        Show what --apply would write, without writing it.
 *   --trigger        Call POST /api/inventory/shopify-sync on APP_URL after a
 *                    successful --apply (or on its own if already configured).
 *
 * Required env vars (in .env.local or environment):
 *   NEXT_PUBLIC_SUPABASE_URL     Hosted Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY    Service role key (bypasses RLS)
 *
 * For --apply:
 *   SHOPIFY_OUTBOUND_ACCESS_TOKEN  Shopify Admin API access token
 *                                  (needs write_inventory scope)
 *   SHOPIFY_OUTBOUND_LOCATION_ID   Numeric Shopify location ID
 *   SHOPIFY_OUTBOUND_SHOP_DOMAIN   e.g. your-shop.myshopify.com
 *
 * For --trigger:
 *   APP_URL                        Base URL of the running app, e.g.
 *                                  https://microfill.vercel.app
 *   CRON_SECRET                    Used if triggering via the cron-secret
 *                                  header (optional fallback for direct POST)
 *
 * Optional:
 *   DEFAULT_TENANT_ID  Override the default demo tenant UUID
 *   WEBHOOK_TENANT_ID  Override the default demo tenant UUID (higher priority)
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const envFilePath = path.join(workspaceRoot, ".env.local");

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((a) => a.startsWith("--")));
const skuArgs = rawArgs.filter((a) => !a.startsWith("--"));

const applyCredentials = flags.has("--apply");
const dryRun = flags.has("--dry-run");
const triggerSync = flags.has("--trigger");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const supabaseUrl = requireConfig("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireConfig("SUPABASE_SERVICE_ROLE_KEY");
const tenantId = getConfig(
  "WEBHOOK_TENANT_ID",
  getConfig("DEFAULT_TENANT_ID", "10000000-0000-0000-0000-000000000001"),
);

// ---------------------------------------------------------------------------
// Supabase REST helpers
// ---------------------------------------------------------------------------

async function supabaseGet(pathname) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase GET failed: ${response.status} ${body}`);
  }
  return response.json();
}

async function supabasePatch(pathname, payload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase PATCH failed: ${response.status} ${body}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("Shopify outbound sync — configuration check");
console.log(`Tenant: ${tenantId}`);
console.log("");

// 1. Load integration
const integrations = await supabaseGet(
  `integrations?tenant_id=eq.${encodeURIComponent(tenantId)}&provider=eq.shopify&select=id,status,display_name,api_key,external_shop_domain,config,last_synced_at,last_error&limit=1`,
);
const integration = integrations[0] ?? null;

if (!integration) {
  console.log("ERROR: No Shopify integration record found for this tenant.");
  console.log(
    "Create one via the dashboard → Integrations → Shopify, then re-run this script.",
  );
  process.exit(1);
}

const existingConfig =
  integration.config && typeof integration.config === "object"
    ? integration.config
    : {};

const hasAccessToken = Boolean(integration.api_key);
const hasShop = Boolean(integration.external_shop_domain);
const locationId =
  typeof existingConfig.shopifyLocationId === "string"
    ? existingConfig.shopifyLocationId.trim()
    : null;
const hasLocationId = Boolean(locationId);
const isActive = integration.status === "active";

console.log("Integration record:");
console.log(`  ID:            ${integration.id}`);
console.log(
  `  Status:        ${integration.status}${isActive ? "" : "  ← must be active"}`,
);
console.log(`  Display name:  ${integration.display_name ?? "n/a"}`);
console.log(
  `  Shop domain:   ${integration.external_shop_domain ?? "NOT SET  ←"}`,
);
console.log(`  Access token:  ${hasAccessToken ? "(set)" : "NOT SET  ←"}`);
console.log(`  Location ID:   ${hasLocationId ? locationId : "NOT SET  ←"}`);
console.log(`  Last synced:   ${integration.last_synced_at ?? "Never"}`);
console.log(`  Last error:    ${integration.last_error ?? "None"}`);
console.log("");

// 2. Load inventory items
const allItems = await supabaseGet(
  `inventory_items?tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,sku,shopify_variant_id,shopify_inventory_item_id,total_quantity,committed_quantity,safety_floor_quantity,flash_mode_enabled&order=sku.asc`,
);

const eligible = allItems.filter(
  (i) => !i.flash_mode_enabled && i.shopify_variant_id,
);
const flashBlocked = allItems.filter((i) => i.flash_mode_enabled);
const noVariant = allItems.filter(
  (i) => !i.flash_mode_enabled && !i.shopify_variant_id,
);
const cachedItemId = eligible.filter((i) => i.shopify_inventory_item_id);

const skusToShow =
  skuArgs.length > 0
    ? eligible.filter((i) => skuArgs.includes(i.sku))
    : eligible.slice(0, 10);

console.log("Inventory eligibility:");
console.log(`  Total items:       ${allItems.length}`);
console.log(`  Eligible to sync:  ${eligible.length}`);
console.log(`  Flash mode (skip): ${flashBlocked.length}`);
console.log(`  No variant ID:     ${noVariant.length}`);
console.log(
  `  inventory_item_id cached: ${cachedItemId.length} / ${eligible.length}`,
);
console.log("");

if (skusToShow.length > 0) {
  console.log(`Eligible items (showing ${skusToShow.length}):`);
  for (const item of skusToShow) {
    const available = Math.max(
      0,
      item.total_quantity -
        item.committed_quantity -
        item.safety_floor_quantity,
    );
    console.log(
      `  ${item.sku.padEnd(22)} variant=${item.shopify_variant_id}  ` +
        `on_hand=${item.total_quantity}  committed=${item.committed_quantity}  ` +
        `floor=${item.safety_floor_quantity}  available=${available}  ` +
        `item_id=${item.shopify_inventory_item_id ?? "(not cached yet)"}`,
    );
  }
  if (eligible.length > 10 && skuArgs.length === 0) {
    console.log(
      `  … and ${eligible.length - 10} more (pass SKU args to filter)`,
    );
  }
  console.log("");
}

// 3. Configuration issues
const issues = [];
if (!isActive) issues.push("Integration status is not active.");
if (!hasShop) issues.push("external_shop_domain is not set.");
if (!hasAccessToken)
  issues.push("api_key (Admin API access token) is not set.");
if (!hasLocationId)
  issues.push("shopifyLocationId is not in integration config.");

if (issues.length === 0) {
  console.log("Configuration: OK — all required fields are present.");
} else {
  console.log("Configuration issues:");
  for (const issue of issues) {
    console.log(`  ✗ ${issue}`);
  }
}
console.log("");

// 4. --apply: write credentials from env into the integration record
if (applyCredentials || dryRun) {
  const accessToken = requireConfig(
    "SHOPIFY_OUTBOUND_ACCESS_TOKEN",
    "Set SHOPIFY_OUTBOUND_ACCESS_TOKEN in .env.local — needs write_inventory scope.",
  );
  const outboundLocationId = requireConfig(
    "SHOPIFY_OUTBOUND_LOCATION_ID",
    "Set SHOPIFY_OUTBOUND_LOCATION_ID in .env.local — numeric Shopify location ID.",
  );
  const shopDomain = getConfig(
    "SHOPIFY_OUTBOUND_SHOP_DOMAIN",
    integration.external_shop_domain,
  );

  const patch = {
    api_key: accessToken,
    external_shop_domain: shopDomain
      ? shopDomain.trim().toLowerCase()
      : undefined,
    config: {
      ...existingConfig,
      shopifyLocationId: outboundLocationId.trim(),
    },
  };

  if (!patch.external_shop_domain) delete patch.external_shop_domain;

  console.log(
    `${dryRun ? "[DRY RUN] Would write" : "Writing"} to integration ${integration.id}:`,
  );
  console.log(`  api_key:           (${accessToken.length} chars, hidden)`);
  console.log(
    `  external_shop_domain: ${patch.external_shop_domain ?? "(unchanged)"}`,
  );
  console.log(`  config.shopifyLocationId: ${outboundLocationId}`);
  console.log("");

  if (!dryRun) {
    const updated = await supabasePatch(
      `integrations?id=eq.${integration.id}&tenant_id=eq.${encodeURIComponent(tenantId)}`,
      patch,
    );
    if (Array.isArray(updated) && updated.length > 0) {
      console.log("Applied — integration record updated successfully.");
    } else {
      console.log(
        "WARN: PATCH returned empty. Record may not have been updated.",
      );
    }
    console.log("");
  }
}

// 5. --trigger: call POST /api/inventory/shopify-sync
if (triggerSync) {
  const appUrl = requireConfig(
    "APP_URL",
    "Set APP_URL in .env.local, e.g. https://microfill.vercel.app",
  );
  const cronSecret = getConfig("CRON_SECRET");

  const syncUrl = `${appUrl.replace(/\/+$/, "")}/api/inventory/shopify-sync`;
  console.log(`Triggering outbound sync: POST ${syncUrl}`);

  // The sync endpoint requires session auth (cookie) when called from a
  // browser, but in scripts we can call it with the cron secret as a header
  // because the route only checks authentication — it does not validate CRON_SECRET.
  // Use the preflight GET first to confirm the config is readable from outside.
  const preflightRes = await fetch(
    `${appUrl.replace(/\/+$/, "")}/api/inventory/shopify-sync`,
    {
      method: "GET",
      headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {},
    },
  );
  console.log(`  Preflight GET → HTTP ${preflightRes.status}`);

  if (preflightRes.status === 401) {
    console.log(
      "  NOTE: The sync endpoint requires session auth (not CRON_SECRET).",
    );
    console.log(
      "  Trigger manually from the dashboard → Integrations → Shopify → 'Sync inventory to Shopify'.",
    );
  } else if (preflightRes.ok) {
    const preflight = await preflightRes.json();
    console.log(
      "  Preflight result:",
      JSON.stringify(preflight, null, 2).replace(/^/gm, "  "),
    );
  }
  console.log("");
}

// 6. Final diagnosis
if (issues.length === 0) {
  console.log(
    "Ready to sync. Trigger from the dashboard or set --trigger with APP_URL.",
  );
} else if (applyCredentials && !dryRun) {
  console.log(
    "Credentials written. Re-run without --apply to confirm all issues are resolved.",
  );
} else {
  console.log("Next steps to configure outbound sync:");
  console.log("");

  if (!hasAccessToken || !hasLocationId) {
    console.log("  Option A — Dashboard (recommended for production):");
    console.log(
      "    1. Go to https://microfill.vercel.app/dashboard → Integrations → Shopify",
    );
    console.log(
      "    2. Enter your Shopify Admin API access token in the API key field.",
    );
    console.log(
      "    3. Enter your numeric Shopify location ID in the Inventory location ID field.",
    );
    console.log(
      "    4. Click Save Shopify, then click Sync inventory to Shopify.",
    );
    console.log("");
    console.log("  Option B — Script (for local dev / CI):");
    console.log("    Add to .env.local:");
    console.log(
      "      SHOPIFY_OUTBOUND_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxx",
    );
    console.log("      SHOPIFY_OUTBOUND_LOCATION_ID=<numeric location id>");
    console.log("      SHOPIFY_OUTBOUND_SHOP_DOMAIN=your-shop.myshopify.com");
    console.log("");
    console.log(
      "    Then run: node scripts/verify-shopify-outbound-sync.mjs --apply --trigger",
    );
    console.log("");
    console.log(
      "  To find your location ID: Shopify Admin → Settings → Locations → click a location → copy the ID from the URL",
    );
  }
}
