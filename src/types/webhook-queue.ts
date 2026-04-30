import type { Database } from "@/types/supabase";

type WebhookEventRow = Database["public"]["Tables"]["webhook_events"]["Row"];

export type WebhookEventStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "dead_letter";

export type { WebhookEventRow };

export interface WebhookEventInsert {
  tenant_id: string;
  integration_id?: string | null;
  provider: string;
  event_type?: string | null;
  external_id?: string | null;
  provider_message_id?: string | null;
  payload: Record<string, unknown>;
  max_attempts?: number;
}
