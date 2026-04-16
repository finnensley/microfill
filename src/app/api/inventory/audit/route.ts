import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  getAuthenticatedUser,
  getTenantIdForUser,
} from "@/lib/supabase-auth-server";
import { InventoryAuditEntry } from "@/types/inventory";

export async function GET(req: Request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedTenantId = await getTenantIdForUser(user);

  if (!resolvedTenantId) {
    return NextResponse.json(
      {
        error:
          "No tenant is configured for this user. Complete onboarding or assign app_metadata.tenant_id for the user.",
      },
      { status: 409 },
    );
  }

  const requestUrl = new URL(req.url);
  const requestedTenantId = requestUrl.searchParams.get("tenantId");

  if (requestedTenantId && requestedTenantId !== resolvedTenantId) {
    return NextResponse.json(
      { error: "Requested tenant does not match the signed-in user." },
      { status: 403 },
    );
  }

  const requestedLimit = Number(requestUrl.searchParams.get("limit") ?? "12");
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 50)
      : 12;

  const supabase = createServerSupabaseClient();
  const { data: logs, error: logsError } = await supabase
    .from("audit_logs")
    .select(
      "id, action, actor_role, actor_user_id, changed_columns, created_at, inventory_item_id, new_values, old_values, source, tenant_id",
    )
    .eq("tenant_id", resolvedTenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (logsError) {
    return NextResponse.json({ error: logsError.message }, { status: 500 });
  }

  const inventoryItemIds = Array.from(
    new Set(
      (logs ?? [])
        .map((log) => log.inventory_item_id)
        .filter((inventoryItemId): inventoryItemId is string =>
          Boolean(inventoryItemId),
        ),
    ),
  );

  let inventoryMap = new Map<
    string,
    {
      itemLabel: string | null;
      itemProductId: string | null;
      itemSku: string | null;
    }
  >();

  if (inventoryItemIds.length > 0) {
    const { data: inventoryItems, error: inventoryError } = await supabase
      .from("inventory_items")
      .select("id, sku, shopify_product_id")
      .in("id", inventoryItemIds);

    if (inventoryError) {
      return NextResponse.json(
        { error: inventoryError.message },
        { status: 500 },
      );
    }

    inventoryMap = new Map(
      (inventoryItems ?? []).map((item) => [
        item.id,
        {
          itemLabel: item.sku ?? item.shopify_product_id,
          itemProductId: item.shopify_product_id,
          itemSku: item.sku,
        },
      ]),
    );
  }

  const history: InventoryAuditEntry[] = (logs ?? []).map((log) => {
    const itemMeta = log.inventory_item_id
      ? inventoryMap.get(log.inventory_item_id)
      : null;

    return {
      ...log,
      itemLabel: itemMeta?.itemLabel ?? null,
      itemProductId: itemMeta?.itemProductId ?? null,
      itemSku: itemMeta?.itemSku ?? null,
    };
  });

  return NextResponse.json({ history, tenantId: resolvedTenantId });
}
