import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getAuthenticatedUser } from "@/lib/supabase-auth-server";

export async function POST(req: Request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { tenantId?: string };
  const tenantId = body.tenantId?.trim();

  if (!tenantId) {
    return NextResponse.json(
      { error: "tenantId is required." },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseClient();
  const { data: tenant, error: tenantLookupError } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .limit(1)
    .maybeSingle();

  if (tenantLookupError) {
    return NextResponse.json(
      { error: tenantLookupError.message },
      { status: 500 },
    );
  }

  if (!tenant) {
    return NextResponse.json(
      { error: "Selected tenant does not exist." },
      { status: 404 },
    );
  }

  const { error } = await supabase.from("user_tenant_assignments").upsert(
    {
      user_id: user.id,
      tenant_id: tenantId,
      email: user.email ?? null,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tenantId });
}
