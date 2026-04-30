import crypto from "crypto";
import type { InventoryEvent } from "@/services/inventory-sync";
import type { WmsAdapter, WmsNormalizedPayload } from "./types";
import type {
  ShipHeroPOUpdate,
  ShipHeroPOUpdateEnvelope,
  ShipHeroShipmentUpdate,
  ShipHeroShipmentUpdateEnvelope,
} from "@/types/shiphero";

type ShipHeroWebhookBody =
  | ShipHeroPOUpdate
  | ShipHeroPOUpdateEnvelope
  | ShipHeroShipmentUpdate
  | ShipHeroShipmentUpdateEnvelope;

function unwrapBody(body: ShipHeroWebhookBody) {
  const envelopePO = "purchase_order" in body ? body.purchase_order : undefined;
  const envelopeFulfillment =
    "fulfillment" in body ? body.fulfillment : undefined;
  const webhookType =
    envelopePO?.webhook_type ??
    envelopeFulfillment?.webhook_type ??
    ("webhook_type" in body ? body.webhook_type : null);

  // ShipHero sends either an envelope ({ purchase_order: {...} }) or a flat body.
  // Fall back to treating the raw body as the typed payload when no envelope is present.
  const purchaseOrder =
    envelopePO ??
    (webhookType === "PO Update" ? (body as ShipHeroPOUpdate) : undefined);
  const fulfillment =
    envelopeFulfillment ??
    (webhookType === "Shipment Update"
      ? (body as ShipHeroShipmentUpdate)
      : undefined);

  return {
    purchaseOrder,
    fulfillment,
    externalId: purchaseOrder?.po_number ?? fulfillment?.order_number ?? null,
    lineItemCount:
      purchaseOrder?.line_items?.length ?? fulfillment?.line_items?.length ?? 0,
    webhookType,
    warehouseId:
      purchaseOrder?.warehouse_id ?? fulfillment?.warehouse_id ?? undefined,
  };
}

export const shipHeroAdapter: WmsAdapter = {
  provider: "shiphero",
  hmacHeader: "x-shiphero-hmac-sha256",
  hmacFallbackHeaders: ["x-shiphero-webhook-signature"],
  knownEventTypes: ["PO Update", "Shipment Update"],

  getExternalAccountId(rawBody) {
    try {
      const body = JSON.parse(rawBody) as ShipHeroWebhookBody;
      const { warehouseId } = unwrapBody(body);
      return warehouseId !== undefined ? String(warehouseId) : null;
    } catch {
      return null;
    }
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
    const body = JSON.parse(rawBody) as ShipHeroWebhookBody;
    const {
      purchaseOrder,
      fulfillment,
      externalId,
      lineItemCount,
      webhookType,
    } = unwrapBody(body);

    let events: InventoryEvent[] = [];
    let responseContext: Record<string, unknown> | undefined;

    if (webhookType === "PO Update" && purchaseOrder) {
      events = purchaseOrder.line_items.map((item) => ({
        type: "stock_received" as const,
        sku: item.sku,
        quantity: item.quantity_received,
        source: "shiphero" as const,
        externalId: purchaseOrder.po_number,
        tenantId,
      }));
      responseContext = { po_number: purchaseOrder.po_number };
    } else if (webhookType === "Shipment Update" && fulfillment) {
      events = fulfillment.line_items.map((item) => ({
        type: "stock_shipped" as const,
        sku: item.sku,
        quantity: item.quantity,
        source: "shiphero" as const,
        externalId: fulfillment.order_number,
        tenantId,
      }));
      responseContext = { tracking: fulfillment.tracking_number };
    }

    return {
      eventType: webhookType ?? null,
      externalId,
      events,
      lineItemCount,
      responseContext,
    };
  },

  getReplayCommand(eventType) {
    if (eventType === "PO Update") {
      return "npm run webhook:replay:shiphero:po";
    }
    if (eventType === "Shipment Update") {
      return "npm run webhook:replay:shiphero:shipment";
    }
    return null;
  },

  getEnvSecretKey() {
    return "SHIPHERO_WEBHOOK_SECRET";
  },
};
