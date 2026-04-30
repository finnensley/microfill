/**
 * Fishbowl Inventory WMS Adapter — stub implementation.
 *
 * This adapter satisfies the WmsAdapter interface so the registry and routing
 * infrastructure are ready. The `verifySignature`, `normalize`, and
 * `getExternalAccountId` methods will be filled in once Fishbowl credentials
 * and a sandbox environment are available.
 *
 * To complete this adapter:
 *   1. Confirm the HMAC algorithm Fishbowl uses for webhook auth (or replace
 *      with API-key / IP-allowlist auth if applicable).
 *   2. Implement normalize() using the real Fishbowl payload shapes in
 *      src/types/fishbowl.ts.
 *   3. Add FISHBOWL_WEBHOOK_SECRET to .env.local and Vercel env vars.
 *   4. Create src/app/api/webhooks/fishbowl/route.ts following the pattern
 *      used by the ShipHero route.
 *   5. Register this adapter in src/services/wms-adapters/index.ts.
 */

import type { WmsAdapter, WmsNormalizedPayload } from "./types";

export const fishbowlAdapter: WmsAdapter = {
  provider: "fishbowl",
  hmacHeader: "x-fishbowl-hmac-sha256",
  hmacFallbackHeaders: [],
  knownEventTypes: ["receiving", "shipment"],

  getEnvSecretKey(): string {
    return "FISHBOWL_WEBHOOK_SECRET";
  },

  getExternalAccountId(_rawBody: string): string | null {
    // TODO: extract Fishbowl warehouse/account ID from payload
    return null;
  },

  verifySignature(
    _rawBody: string,
    _secret: string,
    _signature: string,
  ): boolean {
    // TODO: implement HMAC-SHA256 verification matching Fishbowl's algorithm
    // Stub returns false so unimplemented routes are safely rejected
    return false;
  },

  normalize(rawBody: string, tenantId: string): WmsNormalizedPayload {
    // TODO: parse Fishbowl payload and convert to InventoryEvent[]
    void rawBody;
    void tenantId;
    return {
      eventType: null,
      externalId: null,
      events: [],
      lineItemCount: 0,
      responseContext: {},
    };
  },

  getReplayCommand(eventType: string | null): string | null {
    if (eventType === "receiving") {
      return "npm run webhook:replay:fishbowl:receiving";
    }
    if (eventType === "shipment") {
      return "npm run webhook:replay:fishbowl:shipment";
    }
    return null;
  },
};
