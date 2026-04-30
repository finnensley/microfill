import "server-only";

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  getAuthenticatedUser,
  getTenantIdForUser,
} from "@/lib/supabase-auth-server";

/**
 * GET /api/queue/status
 *
 * Returns aggregate webhook_events counts by status for the authenticated
 * tenant. Intended for the dashboard queue health panel.
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

  const { data, error } = await supabase
    .from("webhook_events")
    .select("status")
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("Failed to fetch queue status", error);
    return NextResponse.json(
      { error: "Failed to fetch queue status" },
      { status: 500 },
    );
  }

  const counts: Record<string, number> = {
    dead_letter: 0,
    failed: 0,
    pending: 0,
    processing: 0,
    succeeded: 0,
  };

  for (const row of data ?? []) {
    if (row.status in counts) {
      counts[row.status]++;
    }
  }

  const recentFailed = await supabase
    .from("webhook_events")
    .select(
      "id, provider, event_type, last_error, updated_at, attempts, max_attempts",
    )
    .eq("tenant_id", tenantId)
    .in("status", ["failed", "dead_letter"])
    .order("updated_at", { ascending: false })
    .limit(5);

  return NextResponse.json({
    counts,
    recentFailed: recentFailed.data ?? [],
    total: data?.length ?? 0,
  });
}
