import type { InventoryEvent } from "@/services/inventory-sync";

/**
 * Canonical set of WMS and storefront providers supported by the platform.
 * This is the single source of truth referenced by inventory-sync, integrations,
 * and the dashboard. Add new providers here first.
 */
export type WmsProvider = "shopify" | "shiphero" | "fishbowl" | "netsuite";

export interface WmsNormalizedPayload {
  /** Provider-specific event label, e.g. "PO Update" or "Shipment Update" */
  eventType: string | null;
  /** External reference: PO number, order number, etc. */
  externalId: string | null;
  /** Ready-to-process inventory events for processSyncEventsBatch */
  events: InventoryEvent[];
  /** Number of line items in the original payload */
  lineItemCount: number;
  /**
   * Extra provider-specific values spread into the HTTP response.
   * Example: { po_number: "PO-101" } for PO updates, { tracking: "TRACK-123" } for shipments.
   */
  responseContext?: Record<string, unknown>;
}

/**
 * Contract every WMS webhook adapter must satisfy.
 *
 * Adding a new WMS integration requires:
 *   1. A type definition file in src/types/<provider>.ts for the provider's payload shapes.
 *   2. An adapter in src/services/wms-adapters/<provider>.ts implementing this interface.
 *   3. Registration in src/services/wms-adapters/index.ts.
 *   4. A webhook route at src/app/api/webhooks/<provider>/route.ts.
 *   5. An environment variable for the webhook secret (named by getEnvSecretKey).
 */
export interface WmsAdapter {
  provider: WmsProvider;
  /** Primary HMAC header sent by this provider */
  hmacHeader: string;
  /** Alternative HMAC header names accepted from this provider, in preference order */
  hmacFallbackHeaders?: readonly string[];
  /**
   * Provider-specific event type labels this adapter handles.
   * Payloads with event types not in this list are treated as unsupported.
   */
  knownEventTypes: readonly string[];
  /**
   * Extract the provider account or warehouse identifier from the raw body.
   * Called before signature verification to look up the integration record.
   * Return null when the body does not contain an account identifier.
   */
  getExternalAccountId(rawBody: string): string | null;
  /**
   * Constant-time HMAC-SHA256 signature verification.
   * Returns true only when the computed digest matches the received header value.
   */
  verifySignature(
    rawBody: string,
    secret: string,
    receivedHmac: string,
  ): boolean;
  /**
   * Parse the provider payload and return normalized inventory events.
   * Called only after the signature is verified and the tenant is resolved.
   */
  normalize(rawBody: string, tenantId: string): WmsNormalizedPayload;
  /** Map a provider-specific event type to the matching local replay command */
  getReplayCommand(eventType: string | null): string | null;
  /**
   * The environment variable key holding the fallback webhook secret.
   * Example: "SHIPHERO_WEBHOOK_SECRET"
   */
  getEnvSecretKey(): string;
}
