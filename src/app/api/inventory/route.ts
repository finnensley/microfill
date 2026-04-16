import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  getAuthenticatedUser,
  getTenantIdForUser,
} from "@/lib/supabase-auth-server";

type InventoryUpdateBody = {
  flashModeEnabled?: boolean;
  itemId?: string;
  safetyFloorPercent?: number;
  totalQuantity?: number;
};

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

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("tenant_id", resolvedTenantId)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [], tenantId: resolvedTenantId });
}

export async function PATCH(req: Request) {
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

  const body = (await req.json()) as InventoryUpdateBody;
  const itemId = body.itemId?.trim();

  if (!itemId) {
    return NextResponse.json({ error: "itemId is required." }, { status: 400 });
  }

  const updates: InventoryUpdateBody = {};

  if (body.totalQuantity !== undefined) {
    if (!Number.isInteger(body.totalQuantity) || body.totalQuantity < 0) {
      return NextResponse.json(
        { error: "totalQuantity must be a non-negative integer." },
        { status: 400 },
      );
    }

    updates.totalQuantity = body.totalQuantity;
  }

  if (body.safetyFloorPercent !== undefined) {
    if (
      typeof body.safetyFloorPercent !== "number" ||
      Number.isNaN(body.safetyFloorPercent) ||
      body.safetyFloorPercent < 0 ||
      body.safetyFloorPercent > 100
    ) {
      return NextResponse.json(
        { error: "safetyFloorPercent must be a number between 0 and 100." },
        { status: 400 },
      );
    }

    updates.safetyFloorPercent = body.safetyFloorPercent;
  }

  if (body.flashModeEnabled !== undefined) {
    if (typeof body.flashModeEnabled !== "boolean") {
      return NextResponse.json(
        { error: "flashModeEnabled must be a boolean value." },
        { status: 400 },
      );
    }

    updates.flashModeEnabled = body.flashModeEnabled;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one of totalQuantity, safetyFloorPercent, or flashModeEnabled.",
      },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseClient();
  const { data: existingItem, error: lookupError } = await supabase
    .from("inventory_items")
    .select("id, tenant_id, committed_quantity")
    .eq("id", itemId)
    .eq("tenant_id", resolvedTenantId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }

  if (!existingItem) {
    return NextResponse.json(
      { error: "Inventory item not found for this tenant." },
      { status: 404 },
    );
  }

  if (
    updates.totalQuantity !== undefined &&
    updates.totalQuantity < existingItem.committed_quantity
  ) {
    return NextResponse.json(
      {
        error:
          "totalQuantity cannot be lower than the currently committed quantity.",
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("inventory_items")
    .update({
      total_quantity: updates.totalQuantity,
      safety_floor_percent: updates.safetyFloorPercent,
      flash_mode_enabled: updates.flashModeEnabled,
    })
    .eq("id", itemId)
    .eq("tenant_id", resolvedTenantId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item: data, tenantId: resolvedTenantId });
}
