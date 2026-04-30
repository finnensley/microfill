import "server-only";

import { NextResponse } from "next/server";
import { getWmsAdapter } from "@/services/wms-adapters";
import {
  claimNextBatch,
  markEventSucceeded,
  markEventFailed,
} from "@/services/webhook-queue";
import { processSyncEventsBatch } from "@/services/inventory-sync";
import type { WmsProvider } from "@/services/wms-adapters/types";

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 100;

/**
 * Webhook queue processor.
 *
 * Claims pending events from webhook_events and processes them through
 * the matching WMS adapter. Called by Vercel Cron on a 1-minute schedule,
 * or triggered manually for replay and testing.
 *
 * Protected by CRON_SECRET when the env var is set so only authorized
 * callers can trigger processing.
 */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let batchSize = DEFAULT_BATCH_SIZE;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (typeof body.batchSize === "number") {
      batchSize = Math.min(Math.max(1, body.batchSize), MAX_BATCH_SIZE);
    }
  } catch {
    // body parsing failure is non-fatal; fall back to default batch size
  }

  let events;
  try {
    events = await claimNextBatch(batchSize);
  } catch (err) {
    console.error("Failed to claim webhook events:", err);
    return NextResponse.json(
      { error: "Failed to claim events from queue" },
      { status: 500 },
    );
  }

  if (events.length === 0) {
    return NextResponse.json(
      { message: "Queue empty", processed: 0 },
      { status: 200 },
    );
  }

  let succeeded = 0;
  let failed = 0;

  for (const event of events) {
    const adapter = getWmsAdapter(event.provider as WmsProvider);

    if (!adapter) {
      const errMsg = `No adapter registered for provider: ${event.provider}`;
      console.error(errMsg, { eventId: event.id, provider: event.provider });
      await markEventFailed(
        event.id,
        errMsg,
        event.attempts,
        event.max_attempts,
      );
      failed++;
      continue;
    }

    try {
      const normalized = adapter.normalize(
        JSON.stringify(event.payload),
        event.tenant_id,
      );

      console.info("Processing queued webhook event", {
        eventId: event.id,
        provider: event.provider,
        eventType: event.event_type,
        externalId: event.external_id,
        inventoryEvents: normalized.events.length,
        attempt: event.attempts,
      });

      if (normalized.events.length === 0) {
        // Nothing to process (empty line items) — mark done
        await markEventSucceeded(event.id);
        succeeded++;
        continue;
      }

      const result = await processSyncEventsBatch(normalized.events);

      if (result.failed > 0 && result.succeeded === 0) {
        // Total failure — retry or dead-letter
        const errMsg = `All ${result.failed} sync events failed for ${event.event_type ?? event.provider} ${event.external_id ?? event.id}`;
        console.error(errMsg, {
          eventId: event.id,
          attempt: event.attempts,
          maxAttempts: event.max_attempts,
        });
        await markEventFailed(
          event.id,
          errMsg,
          event.attempts,
          event.max_attempts,
        );
        failed++;
      } else {
        if (result.failed > 0) {
          console.warn("Partial failure — marking succeeded for partial sync", {
            eventId: event.id,
            ...result,
          });
        }
        await markEventSucceeded(event.id);
        succeeded++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Unhandled error processing event ${event.id}:`, errMsg);
      await markEventFailed(
        event.id,
        errMsg,
        event.attempts,
        event.max_attempts,
      );
      failed++;
    }
  }

  console.info("Queue batch complete", {
    processed: events.length,
    succeeded,
    failed,
  });

  return NextResponse.json(
    { processed: events.length, succeeded, failed },
    { status: 200 },
  );
}
