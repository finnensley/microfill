import "server-only";

import { NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getTenantIdForUser,
} from "@/lib/supabase-auth-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { pushInventoryToShopify } from "@/services/shopify-sync";

/**
 * GET /api/inventory/shopify-sync
 *
 * Returns a configuration preflight for the authenticated tenant's Shopify
 * outbound sync. Indicates which credentials are set, which are missing, and
 * how many inventory items are eligible for sync.
 *
 * Does not expose credential values — only reports whether they are present.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = await getTenantIdForUser(user);
  if (!tenantId) {
    return NextResponse.json(
      { error: "No tenant configured" },
      { status: 409 },
    );
  }

  const supabase = createServerSupabaseClient();

  const { data: integration } = await supabase
    .from("integrations")
    .select("api_key, external_shop_domain, config, status")
    .eq("tenant_id", tenantId)
    .eq("provider", "shopify")
    .maybeSingle();

  const config = (integration?.config as Record<string, unknown> | null) ?? {};
  const locationId =
    typeof config.shopifyLocationId === "string"
      ? config.shopifyLocationId.trim()
      : null;

  const hasAccessToken = Boolean(integration?.api_key);
  const shop = integration?.external_shop_domain ?? null;
  const isActive = integration?.status === "active";

  const issues: string[] = [];
  if (!integration) issues.push("No Shopify integration record found.");
  if (!isActive) issues.push("Shopify integration is not active.");
  if (!hasAccessToken)
    issues.push("api_key (Admin API access token) is not set.");
  if (!shop) issues.push("external_shop_domain is not set.");
  if (!locationId) issues.push("shopifyLocationId is not set in config.");

  // Count eligible items
  const { data: allItems } = await supabase
    .from("inventory_items")
    .select("id, flash_mode_enabled, shopify_variant_id")
    .eq("tenant_id", tenantId);

  const total = allItems?.length ?? 0;
  const flashModeBlocked =
    allItems?.filter((i) => i.flash_mode_enabled).length ?? 0;
  const noVariantId =
    allItems?.filter((i) => !i.shopify_variant_id).length ?? 0;
  const eligible = total - flashModeBlocked - noVariantId;

  return NextResponse.json({
    configured: issues.length === 0,
    issues,
    shop,
    hasAccessToken,
    hasLocationId: Boolean(locationId),
    locationId,
    items: { total, eligible, flashModeBlocked, noVariantId },
  });
}

/**
 * POST /api/inventory/shopify-sync
 *
 * Manually trigger an outbound inventory push to Shopify for the authenticated
 * tenant. Pushes the current available quantity for all catalog items that have
 * a shopify_variant_id set and do not have flash_mode_enabled.
 *
 * Returns { synced, skipped, errors } from the sync run.
 *
 * The queue worker also calls this automatically after each successful
 * stock_received event so the storefront stays up to date without manual
 * operator action.
 */
export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = await getTenantIdForUser(user);
  if (!tenantId) {
    return NextResponse.json(
      { error: "No tenant configured" },
      { status: 409 },
    );
  }

  const result = await pushInventoryToShopify({ tenantId });

  return NextResponse.json(result, { status: 200 });
}
