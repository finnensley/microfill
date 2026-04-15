import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  getAuthenticatedUser,
  getTenantIdForUser,
} from "@/lib/supabase-auth-server";

export async function GET(req: Request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedTenantId = getTenantIdForUser(user);

  if (!resolvedTenantId) {
    return NextResponse.json(
      {
        error:
          "No tenant is configured for this user. Add app_metadata.tenant_id or set DEFAULT_TENANT_ID for local development.",
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
