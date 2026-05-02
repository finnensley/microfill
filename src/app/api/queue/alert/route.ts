import "server-only";

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * GET /api/queue/alert
 *
 * Checks for dead-lettered webhook_events across all tenants and returns
 * a machine-readable alert payload.
 *
 * Returns 200 { alert: false } when the queue is clean.
 * Returns 409 { alert: true, dead_letter_count, samples } when events
 * require operator attention.
 *
 * Protected by CRON_SECRET so it can be polled by GitHub Actions without
 * a user session. Intended to be called by alert-dead-letters.yml on a
 * schedule so GitHub sends failure email when dead-letters accumulate.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServerSupabaseClient();

  const { data: deadLetters, error } = await supabase
    .from("webhook_events")
    .select(
      "id, tenant_id, provider, event_type, last_error, updated_at, attempts, max_attempts",
    )
    .eq("status", "dead_letter")
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Dead-letter alert query failed:", error);
    return NextResponse.json(
      { error: "Failed to query dead-letter events" },
      { status: 500 },
    );
  }

  const count = deadLetters?.length ?? 0;

  if (count === 0) {
    return NextResponse.json({ alert: false, dead_letter_count: 0 });
  }

  const samples = (deadLetters ?? []).map((e) => ({
    id: e.id,
    provider: e.provider,
    event_type: e.event_type,
    attempts: e.attempts,
    max_attempts: e.max_attempts,
    last_error: e.last_error,
    updated_at: e.updated_at,
  }));

  return NextResponse.json(
    {
      alert: true,
      dead_letter_count: count,
      message: `${count} webhook event${count === 1 ? "" : "s"} dead-lettered and require operator attention.`,
      samples,
    },
    { status: 409 },
  );
}
