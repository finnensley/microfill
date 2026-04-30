import "server-only";

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * GET /api/health
 *
 * Lightweight liveness probe. Checks DB connectivity and returns timestamp.
 * Does not require authentication — intended for uptime monitoring tools.
 */
export async function GET() {
  let db = false;

  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from("tenants").select("id").limit(1);
    db = !error;
  } catch {
    // db stays false
  }

  return NextResponse.json(
    { db, ok: db, timestamp: new Date().toISOString() },
    { status: db ? 200 : 503 },
  );
}
