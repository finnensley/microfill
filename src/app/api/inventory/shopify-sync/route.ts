import "server-only";

import { NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getTenantIdForUser,
} from "@/lib/supabase-auth-server";
import { pushInventoryToShopify } from "@/services/shopify-sync";

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
