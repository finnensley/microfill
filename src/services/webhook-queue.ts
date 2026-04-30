import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Json } from "@/types/supabase";
import type {
  WebhookEventInsert,
  WebhookEventRow,
} from "@/types/webhook-queue";

const DEFAULT_MAX_ATTEMPTS = 3;

/** Minutes to delay before retrying after each failed attempt. */
function retryDelayMinutes(attemptNumber: number): number {
  // 5 min after first failure, 30 min thereafter
  return attemptNumber <= 1 ? 5 : 30;
}

/**
 * Persist a verified webhook payload to the queue.
 * Call this after HMAC verification, before returning 2xx to the provider.
 */
export async function enqueueWebhookEvent(
  event: WebhookEventInsert,
): Promise<WebhookEventRow> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("webhook_events")
    .insert({
      tenant_id: event.tenant_id,
      integration_id: event.integration_id ?? null,
      provider: event.provider,
      event_type: event.event_type ?? null,
      external_id: event.external_id ?? null,
      provider_message_id: event.provider_message_id ?? null,
      payload: event.payload as Json,
      max_attempts: event.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to enqueue webhook event: ${error.message}`);
  }

  return data as WebhookEventRow;
}

/**
 * Atomically claim the next batch of pending events for processing.
 * Uses SELECT FOR UPDATE SKIP LOCKED via a database function so concurrent
 * workers do not claim the same events.
 */
export async function claimNextBatch(
  batchSize: number = 10,
): Promise<WebhookEventRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("claim_webhook_events", {
    batch_size: batchSize,
  });

  if (error) {
    throw new Error(`Failed to claim webhook events: ${error.message}`);
  }

  return (data ?? []) as WebhookEventRow[];
}

/**
 * Mark an event as successfully processed. Terminal state.
 */
export async function markEventSucceeded(id: string): Promise<void> {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("webhook_events")
    .update({ status: "succeeded" })
    .eq("id", id);

  if (error) {
    console.error(`Failed to mark event ${id} succeeded:`, error.message);
  }
}

/**
 * Mark an event as failed.
 * - If attempts < max_attempts: reset to pending with a delayed next_attempt_at.
 * - If attempts >= max_attempts: move to dead_letter (terminal).
 */
export async function markEventFailed(
  id: string,
  lastError: string,
  currentAttempts: number,
  maxAttempts: number,
): Promise<void> {
  const supabase = createServerSupabaseClient();

  if (currentAttempts >= maxAttempts) {
    const { error } = await supabase
      .from("webhook_events")
      .update({ status: "dead_letter", last_error: lastError })
      .eq("id", id);

    if (error) {
      console.error(`Failed to dead-letter event ${id}:`, error.message);
    }
    return;
  }

  const nextAttemptAt = new Date(
    Date.now() + retryDelayMinutes(currentAttempts) * 60 * 1000,
  ).toISOString();

  const { error } = await supabase
    .from("webhook_events")
    .update({
      status: "pending",
      last_error: lastError,
      next_attempt_at: nextAttemptAt,
    })
    .eq("id", id);

  if (error) {
    console.error(`Failed to schedule retry for event ${id}:`, error.message);
  }
}
