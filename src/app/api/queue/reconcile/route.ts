import "server-only";

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * Events stuck in `processing` for longer than this are assumed to belong to
 * a crashed worker and are eligible for reset.
 */
const STUCK_THRESHOLD_MINUTES = 10;

/**
 * POST /api/queue/reconcile
 *
 * Finds webhook_events stuck in `processing` state for longer than
 * STUCK_THRESHOLD_MINUTES and resets them to `pending` so the next
 * worker invocation can retry them.
 *
 * Protected by CRON_SECRET. Intended to be called by a scheduled GitHub
 * Action every 15 minutes as a safety net against worker crashes.
 */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServerSupabaseClient();

  const stuckBefore = new Date(
    Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000,
  ).toISOString();

  // Retry after 5 minutes to give the system a brief recovery window
  const nextAttemptAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("webhook_events")
    .update({
      status: "pending",
      next_attempt_at: nextAttemptAt,
      last_error: `Reconciler: reset from processing state at ${new Date().toISOString()} (stuck threshold: ${STUCK_THRESHOLD_MINUTES}m)`,
    })
    .eq("status", "processing")
    .lt("updated_at", stuckBefore)
    .select("id");

  if (error) {
    console.error("Reconcile query failed:", error);
    return NextResponse.json(
      { error: "Reconcile query failed" },
      { status: 500 },
    );
  }

  const reset = data?.length ?? 0;

  if (reset > 0) {
    console.warn(`Reconciler reset ${reset} stuck event(s) to pending`, {
      stuckBefore,
      ids: data?.map((r) => r.id),
    });
  } else {
    console.info("Reconciler: no stuck events found");
  }

  return NextResponse.json({ reset }, { status: 200 });
}
