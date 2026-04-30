import crypto from "crypto";
import type { InventoryEvent } from "@/services/inventory-sync";
import type { WmsAdapter, WmsNormalizedPayload } from "./types";

type ShopifyLineItem = {
  quantity: number;
  variant_id: number | string | null;
};

type ShopifyOrder = {
  id: number | string;
  line_items?: ShopifyLineItem[];
};

export const shopifyAdapter: WmsAdapter = {
  provider: "shopify",
  hmacHeader: "x-shopify-hmac-sha256",
  hmacFallbackHeaders: [],
  knownEventTypes: ["orders/create"],

  getExternalAccountId(_rawBody) {
    // Shop identity comes from Shopify request headers, not the order body.
    return null;
  },

  verifySignature(rawBody, secret, receivedHmac) {
    const generated = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");
    if (generated.length !== receivedHmac.length) {
      return false;
    }
    return crypto.timingSafeEqual(
      Buffer.from(generated, "utf8"),
      Buffer.from(receivedHmac, "utf8"),
    );
  },

  normalize(rawBody, tenantId): WmsNormalizedPayload {
    const order = JSON.parse(rawBody) as ShopifyOrder;
    const orderId = String(order.id);
    const lineItems = order.line_items ?? [];

    const events: InventoryEvent[] = lineItems
      .filter(
        (item) =>
          item.variant_id !== null &&
          item.variant_id !== undefined &&
          item.variant_id !== "",
      )
      .map((item) => ({
        type: "order_committed" as const,
        sku: "",
        variantId: String(item.variant_id),
        quantity: item.quantity,
        source: "shopify" as const,
        externalId: orderId,
        tenantId,
      }));

    return {
      eventType: "orders/create",
      externalId: orderId,
      events,
      lineItemCount: lineItems.length,
      responseContext: { order_id: orderId },
    };
  },

  getReplayCommand(_eventType) {
    return "npm run webhook:replay:shopify";
  },

  getEnvSecretKey() {
    return "SHOPIFY_WEBHOOK_SECRET";
  },
};
