import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase-server";

const SHOPIFY_API_VERSION = "2024-10";

export interface ShopifyPushResult {
  synced: number;
  skipped: number;
  errors: number;
}

interface PushOptions {
  tenantId: string;
  /** If provided, only sync the item with this SKU. Omit to sync all items. */
  sku?: string;
}

/**
 * Look up the Shopify inventory_item_id for a variant.
 * Shopify's inventory_item_id is distinct from the product/variant ID and is
 * required for the inventory_levels REST endpoints.
 */
async function fetchInventoryItemId(
  shop: string,
  accessToken: string,
  variantId: string,
): Promise<string | null> {
  try {
    const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/variants/${variantId}.json`;
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });

    if (!res.ok) {
      console.warn(
        `Shopify variant lookup failed for variant ${variantId}: HTTP ${res.status}`,
      );
      return null;
    }

    const data = (await res.json()) as {
      variant?: { inventory_item_id?: number };
    };
    const id = data.variant?.inventory_item_id;
    return id != null ? String(id) : null;
  } catch (err) {
    console.warn(`Shopify variant lookup threw for variant ${variantId}:`, err);
    return null;
  }
}

/**
 * Set the available quantity for a specific inventory item at a Shopify location.
 * Uses the inventory_levels/set REST endpoint (absolute, not a delta).
 */
async function setInventoryLevel(
  shop: string,
  accessToken: string,
  locationId: string,
  inventoryItemId: string,
  available: number,
): Promise<boolean> {
  try {
    const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        location_id: locationId,
        inventory_item_id: inventoryItemId,
        available,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `Shopify inventory_levels/set failed for inventory_item ${inventoryItemId}: HTTP ${res.status} — ${text}`,
      );
      return false;
    }

    return true;
  } catch (err) {
    console.warn(
      `Shopify setInventoryLevel threw for inventory_item ${inventoryItemId}:`,
      err,
    );
    return false;
  }
}

/**
 * Push current available quantities to the Shopify Inventory API.
 *
 * For each inventory item in the tenant's catalog:
 * - Skips items with flash_mode_enabled (operator-controlled pause)
 * - Skips items with no shopify_variant_id
 * - Looks up and caches shopify_inventory_item_id if not already stored
 * - Computes available = total_quantity - committed_quantity - safety_floor_quantity
 * - Calls inventory_levels/set to write the absolute available quantity
 *
 * Requires the tenant's Shopify integration to have:
 * - api_key (Shopify Admin API access token)
 * - external_shop_domain (e.g. demo-shop.myshopify.com)
 * - config.shopifyLocationId (numeric Shopify location ID as string)
 *
 * Failures on individual items are counted and logged but do not throw.
 * The caller can inspect the returned counts to surface errors to operators.
 */
export async function pushInventoryToShopify(
  options: PushOptions,
): Promise<ShopifyPushResult> {
  const { tenantId, sku } = options;
  const supabase = createServerSupabaseClient();

  // Load the tenant's active Shopify integration
  const { data: integration, error: intError } = await supabase
    .from("integrations")
    .select("api_key, external_shop_domain, config")
    .eq("tenant_id", tenantId)
    .eq("provider", "shopify")
    .eq("status", "active")
    .maybeSingle();

  if (intError) {
    console.error(
      "Shopify sync: failed to load integration:",
      intError.message,
    );
    return { synced: 0, skipped: 0, errors: 1 };
  }

  if (!integration) {
    // No active Shopify integration — not an error, just nothing to do
    return { synced: 0, skipped: 0, errors: 0 };
  }

  const accessToken = integration.api_key;
  const shop = integration.external_shop_domain;
  const config = (integration.config as Record<string, unknown> | null) ?? {};
  const locationId =
    typeof config.shopifyLocationId === "string"
      ? config.shopifyLocationId.trim()
      : null;

  if (!accessToken || !shop) {
    console.warn("Shopify sync: integration missing api_key or shop domain", {
      tenantId,
    });
    return { synced: 0, skipped: 0, errors: 1 };
  }

  if (!locationId) {
    console.warn(
      "Shopify sync: shopifyLocationId not configured — set it in the dashboard integration settings",
      { tenantId },
    );
    return { synced: 0, skipped: 0, errors: 1 };
  }

  // Load inventory items for the tenant
  let itemQuery = supabase
    .from("inventory_items")
    .select(
      "id, sku, shopify_variant_id, shopify_inventory_item_id, total_quantity, committed_quantity, safety_floor_quantity, flash_mode_enabled",
    )
    .eq("tenant_id", tenantId)
    .not("shopify_variant_id", "is", null);

  if (sku) {
    itemQuery = itemQuery.eq("sku", sku);
  }

  const { data: items, error: itemsError } = await itemQuery;

  if (itemsError) {
    console.error(
      "Shopify sync: failed to load inventory items:",
      itemsError.message,
    );
    return { synced: 0, skipped: 0, errors: 1 };
  }

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of items ?? []) {
    if (item.flash_mode_enabled) {
      console.info(
        `Shopify sync: skipping ${item.sku ?? item.id} (flash mode enabled)`,
      );
      skipped++;
      continue;
    }

    if (!item.shopify_variant_id) {
      skipped++;
      continue;
    }

    let inventoryItemId = item.shopify_inventory_item_id;

    // Fetch and cache shopify_inventory_item_id if not already stored
    if (!inventoryItemId) {
      inventoryItemId = await fetchInventoryItemId(
        shop,
        accessToken,
        item.shopify_variant_id,
      );

      if (inventoryItemId) {
        await supabase
          .from("inventory_items")
          .update({ shopify_inventory_item_id: inventoryItemId })
          .eq("id", item.id);
      }
    }

    if (!inventoryItemId) {
      console.warn(
        `Shopify sync: could not resolve inventory_item_id for variant ${item.shopify_variant_id} (${item.sku ?? item.id})`,
      );
      errors++;
      continue;
    }

    const available = Math.max(
      0,
      item.total_quantity -
        item.committed_quantity -
        item.safety_floor_quantity,
    );

    const ok = await setInventoryLevel(
      shop,
      accessToken,
      locationId,
      inventoryItemId,
      available,
    );

    if (ok) {
      await supabase
        .from("inventory_items")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", item.id);

      console.info(
        `✓ Shopify sync: ${item.sku ?? item.id} available=${available}`,
      );
      synced++;
    } else {
      errors++;
    }
  }

  console.info(
    `Shopify sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`,
  );

  return { synced, skipped, errors };
}
