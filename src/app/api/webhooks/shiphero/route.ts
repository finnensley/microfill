import { NextResponse } from "next/server";
import crypto from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getShipHeroWebhookSecret } from "@/lib/supabase-config";
import { resolveIntegration } from "@/services/integrations";
import {
  ShipHeroPOUpdate,
  ShipHeroPOUpdateEnvelope,
  ShipHeroShipmentUpdate,
  ShipHeroShipmentUpdateEnvelope,
} from "@/types/shiphero";
import {
  processSyncEventsBatch,
  InventoryEvent,
} from "@/services/inventory-sync";

type PersistIntegrationStatusParams = {
  externalId?: string | null;
  failed?: number;
  failureKind?:
    | "internal_error"
    | "invalid_signature"
    | "no_items"
    | "partial_failure"
    | "success"
    | "unsupported_type";
  lastError: string | null;
  lastResult: "failed" | "ignored" | "partial" | "succeeded";
  lineItems?: number;
  operatorAction: string;
  retryCommand?: string | null;
  retryMode: "fix_configuration" | "manual_review" | "provider_retry" | "none";
  retryRecommended: boolean;
  succeeded?: number;
  webhookType?: string | null;
};

type PersistIntegrationStatus = (
  params: PersistIntegrationStatusParams,
) => Promise<void>;
type ShipHeroWebhookBody =
  | ShipHeroPOUpdate
  | ShipHeroPOUpdateEnvelope
  | ShipHeroShipmentUpdate
  | ShipHeroShipmentUpdateEnvelope;

function normalizeIntegrationConfig(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {} as Record<string, unknown>;
  }

  return config as Record<string, unknown>;
}

function normalizeShipHeroWebhookBody(body: ShipHeroWebhookBody) {
  const purchaseOrder =
    "purchase_order" in body ? body.purchase_order : undefined;
  const fulfillment = "fulfillment" in body ? body.fulfillment : undefined;
  const webhookType =
    purchaseOrder?.webhook_type ??
    fulfillment?.webhook_type ??
    ("webhook_type" in body ? body.webhook_type : null);

  return {
    purchaseOrder,
    fulfillment,
    externalId: purchaseOrder?.po_number ?? fulfillment?.order_number ?? null,
    lineItems:
      purchaseOrder?.line_items.length ?? fulfillment?.line_items.length ?? 0,
    webhookType,
    warehouseId:
      purchaseOrder?.warehouse_id ?? fulfillment?.warehouse_id ?? undefined,
  };
}

function buildWebhookStatusMessage(params: {
  externalId: string;
  failed: number;
  lineItems: number;
  succeeded: number;
  webhookType: string;
}) {
  if (params.failed === 0) {
    return null;
  }

  return `type=${params.webhookType} external_id=${params.externalId} line_items=${params.lineItems} succeeded=${params.succeeded} failed=${params.failed}`;
}

function getReplayCommand(webhookType?: string | null) {
  if (webhookType === "PO Update") {
    return "npm run webhook:replay:shiphero:po";
  }

  if (webhookType === "Shipment Update") {
    return "npm run webhook:replay:shiphero:shipment";
  }

  return null;
}

export function HEAD() {
  return new NextResponse(null, { status: 200 });
}

/**
 * ShipHero Webhook Handler
 *
 * Normalizes ShipHero payloads and delegates to generic inventory sync service
 * This keeps the handler lightweight and allows all WMS to share sync logic
 */
export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const tenantHeader = req.headers.get("x-tenant-id");
    const shopIdHeader = req.headers.get("x-shopify-shop-id");
    const shipHeroAccountId = req.headers.get("x-shiphero-account-id");

    // 2. Get raw body for HMAC verification
    const rawBody = await req.text();
    const parsedBody = JSON.parse(rawBody) as ShipHeroWebhookBody;
    const normalizedBody = normalizeShipHeroWebhookBody(parsedBody);
    const hmacHeader =
      req.headers.get("x-shiphero-hmac-sha256")?.trim() ??
      req.headers.get("x-shiphero-webhook-signature")?.trim();

    // 3. Verify HMAC signature - Prevent unauthorized webhook calls
    if (!hmacHeader) {
      console.error("Missing ShipHero HMAC header");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const integration = await resolveIntegration({
      provider: "shiphero",
      tenantId: tenantHeader,
      externalAccountId:
        shipHeroAccountId ??
        shopIdHeader ??
        normalizedBody.warehouseId?.toString() ??
        null,
    });

    const persistIntegrationStatus: PersistIntegrationStatus = async (
      params,
    ) => {
      if (!integration?.id) {
        return;
      }

      const currentConfig = normalizeIntegrationConfig(integration.config);
      const nextConfig = {
        ...currentConfig,
        shipheroWebhookStatus: {
          externalId: params.externalId ?? null,
          failed: params.failed ?? 0,
          failureKind: params.failureKind ?? null,
          lastAttemptAt: new Date().toISOString(),
          lastError: params.lastError,
          lastResult: params.lastResult,
          lastWebhookType: params.webhookType ?? null,
          lineItems: params.lineItems ?? 0,
          operatorAction: params.operatorAction,
          retryCommand: params.retryCommand ?? null,
          retryMode: params.retryMode,
          retryRecommended: params.retryRecommended,
          succeeded: params.succeeded ?? 0,
        },
      };

      const { error } = await supabase
        .from("integrations")
        .update({
          config: nextConfig,
          last_error: params.lastError,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", integration.id)
        .eq("tenant_id", integration.tenant_id);

      if (error) {
        console.error("Unable to persist ShipHero integration status", {
          error: error.message,
          integrationId: integration.id,
          tenantId: integration.tenant_id,
        });
      }
    };

    const resolvedTenantId =
      integration?.tenant_id ?? tenantHeader ?? shopIdHeader;
    const shipHeroWebhookSecret =
      integration?.webhook_secret ?? getShipHeroWebhookSecret();

    if (!resolvedTenantId) {
      console.error("Unable to resolve tenant for ShipHero webhook");
      return NextResponse.json(
        { error: "Missing tenant identifier" },
        { status: 400 },
      );
    }

    const generatedHash = crypto
      .createHmac("sha256", shipHeroWebhookSecret)
      .update(rawBody, "utf8")
      .digest("base64");
    const isSignatureValid =
      generatedHash.length === hmacHeader.length &&
      crypto.timingSafeEqual(
        Buffer.from(generatedHash, "utf8"),
        Buffer.from(hmacHeader, "utf8"),
      );

    // 4. Security Check: Compare hashes
    if (!isSignatureValid) {
      await persistIntegrationStatus({
        externalId: normalizedBody.externalId,
        failed: 1,
        failureKind: "invalid_signature",
        lastError: `Invalid ShipHero webhook signature for ${shipHeroAccountId ?? resolvedTenantId}`,
        lastResult: "failed",
        lineItems: normalizedBody.lineItems,
        operatorAction:
          "Confirm the ShipHero webhook secret and account ID match the provider, then rerun the ShipHero smoke test before replaying the event.",
        retryCommand: getReplayCommand(normalizedBody.webhookType),
        retryMode: "fix_configuration",
        retryRecommended: false,
        succeeded: 0,
        webhookType: normalizedBody.webhookType,
      });
      console.error("Invalid ShipHero webhook signature", {
        tenantId: resolvedTenantId,
        shipHeroAccountId,
        shopIdHeader,
        hasIntegration: Boolean(integration),
        receivedSignaturePrefix: hmacHeader.slice(0, 8),
        expectedSignaturePrefix: generatedHash.slice(0, 8),
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 5. Parse and normalize based on webhook type
    if (normalizedBody.webhookType === "PO Update") {
      return handlePOUpdate(
        normalizedBody.purchaseOrder ?? (parsedBody as ShipHeroPOUpdate),
        resolvedTenantId,
        persistIntegrationStatus,
        shipHeroAccountId ?? normalizedBody.warehouseId?.toString() ?? null,
      );
    } else if (normalizedBody.webhookType === "Shipment Update") {
      return handleShipmentUpdate(
        normalizedBody.fulfillment ?? (parsedBody as ShipHeroShipmentUpdate),
        resolvedTenantId,
        persistIntegrationStatus,
        shipHeroAccountId ?? normalizedBody.warehouseId?.toString() ?? null,
      );
    }

    await persistIntegrationStatus({
      externalId: normalizedBody.externalId,
      failed: 0,
      failureKind: "unsupported_type",
      lastError: `Unsupported ShipHero webhook type: ${normalizedBody.webhookType ?? "unknown"}`,
      lastResult: "ignored",
      lineItems: normalizedBody.lineItems,
      operatorAction:
        "No retry is required unless this webhook type should be supported by the application.",
      retryCommand: null,
      retryMode: "manual_review",
      retryRecommended: false,
      succeeded: 0,
      webhookType: normalizedBody.webhookType,
    });

    console.warn("ShipHero webhook type not handled", {
      externalId: normalizedBody.externalId,
      lineItems: normalizedBody.lineItems,
      tenantId: resolvedTenantId,
      webhookType: normalizedBody.webhookType,
    });

    return NextResponse.json(
      {
        message: "Webhook type not handled",
        retryStrategy: {
          operatorAction:
            "No retry is required unless this webhook type should be supported by the application.",
          retryCommand: null,
          retryMode: "manual_review",
          retryRecommended: false,
        },
        verified: true,
        webhookType: normalizedBody.webhookType,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("ShipHero Webhook Error:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

/**
 * Normalize ShipHero PO Update to generic InventoryEvent
 */
async function handlePOUpdate(
  body: ShipHeroPOUpdate,
  tenantId: string,
  persistIntegrationStatus: PersistIntegrationStatus,
  shipHeroAccountId?: string | null,
) {
  if (!body.line_items || body.line_items.length === 0) {
    await persistIntegrationStatus({
      externalId: body.po_number,
      failed: 0,
      failureKind: "no_items",
      lastError: null,
      lastResult: "ignored",
      lineItems: 0,
      operatorAction:
        "No retry is required because the webhook did not include any PO line items.",
      retryCommand: null,
      retryMode: "none",
      retryRecommended: false,
      succeeded: 0,
      webhookType: body.webhook_type,
    });
    return NextResponse.json(
      {
        message: "No items to process",
        verified: true,
        webhookType: body.webhook_type,
        tenantId,
      },
      { status: 200 },
    );
  }

  // Transform ShipHero payload to generic events
  const events: InventoryEvent[] = body.line_items.map((item) => ({
    type: "stock_received" as const,
    sku: item.sku,
    quantity: item.quantity_received,
    source: "shiphero" as const,
    externalId: body.po_number,
    tenantId,
  }));

  // Process using shared service
  const result = await processSyncEventsBatch(events);

  console.info("Processed ShipHero PO webhook", {
    tenantId,
    shipHeroAccountId: shipHeroAccountId ?? null,
    poNumber: body.po_number,
    lineItems: body.line_items.length,
    ...result,
  });

  const lastError = buildWebhookStatusMessage({
    externalId: body.po_number,
    failed: result.failed,
    lineItems: body.line_items.length,
    succeeded: result.succeeded,
    webhookType: body.webhook_type,
  });

  if (result.failed > 0) {
    console.error("ShipHero PO webhook had failed inventory sync events", {
      tenantId,
      shipHeroAccountId: shipHeroAccountId ?? null,
      poNumber: body.po_number,
      retryCommand: getReplayCommand(body.webhook_type),
      ...result,
    });
  }

  await persistIntegrationStatus({
    externalId: body.po_number,
    failed: result.failed,
    failureKind: result.failed > 0 ? "partial_failure" : "success",
    lastError,
    lastResult: result.failed > 0 ? "partial" : "succeeded",
    lineItems: body.line_items.length,
    operatorAction:
      result.failed > 0
        ? "Review the latest ShipHero integration error, confirm SKU mappings and credentials, then replay the PO fixture if the provider does not retry automatically."
        : "No retry required. The PO update applied successfully.",
    retryCommand:
      result.failed > 0 ? getReplayCommand(body.webhook_type) : null,
    retryMode: result.failed > 0 ? "provider_retry" : "none",
    retryRecommended: result.failed > 0,
    succeeded: result.succeeded,
    webhookType: body.webhook_type,
  });

  return NextResponse.json(
    {
      message: "PO synced",
      verified: true,
      retryStrategy: {
        operatorAction:
          result.failed > 0
            ? "Review the latest ShipHero integration error, confirm SKU mappings and credentials, then replay the PO fixture if the provider does not retry automatically."
            : "No retry required. The PO update applied successfully.",
        retryCommand:
          result.failed > 0 ? getReplayCommand(body.webhook_type) : null,
        retryMode: result.failed > 0 ? "provider_retry" : "none",
        retryRecommended: result.failed > 0,
      },
      tenantId,
      webhookType: body.webhook_type,
      lineItems: body.line_items.length,
      po_number: body.po_number,
      ...result,
    },
    { status: 200 },
  );
}

/**
 * Normalize ShipHero Shipment Update to generic InventoryEvent
 */
async function handleShipmentUpdate(
  body: ShipHeroShipmentUpdate,
  tenantId: string,
  persistIntegrationStatus: PersistIntegrationStatus,
  shipHeroAccountId?: string | null,
) {
  if (!body.line_items || body.line_items.length === 0) {
    await persistIntegrationStatus({
      externalId: body.order_number,
      failed: 0,
      failureKind: "no_items",
      lastError: null,
      lastResult: "ignored",
      lineItems: 0,
      operatorAction:
        "No retry is required because the webhook did not include any shipment line items.",
      retryCommand: null,
      retryMode: "none",
      retryRecommended: false,
      succeeded: 0,
      webhookType: body.webhook_type,
    });
    return NextResponse.json(
      {
        message: "No items to process",
        verified: true,
        webhookType: body.webhook_type,
        tenantId,
      },
      { status: 200 },
    );
  }

  // Transform ShipHero payload to generic events
  const events: InventoryEvent[] = body.line_items.map((item) => ({
    type: "stock_shipped" as const,
    sku: item.sku,
    quantity: item.quantity,
    source: "shiphero" as const,
    externalId: body.order_number,
    tenantId,
  }));

  // Process using shared service
  const result = await processSyncEventsBatch(events);

  console.info("Processed ShipHero shipment webhook", {
    tenantId,
    shipHeroAccountId: shipHeroAccountId ?? null,
    orderNumber: body.order_number,
    tracking: body.tracking_number,
    lineItems: body.line_items.length,
    ...result,
  });

  const lastError = buildWebhookStatusMessage({
    externalId: body.order_number,
    failed: result.failed,
    lineItems: body.line_items.length,
    succeeded: result.succeeded,
    webhookType: body.webhook_type,
  });

  if (result.failed > 0) {
    console.error(
      "ShipHero shipment webhook had failed inventory sync events",
      {
        tenantId,
        shipHeroAccountId: shipHeroAccountId ?? null,
        orderNumber: body.order_number,
        retryCommand: getReplayCommand(body.webhook_type),
        ...result,
      },
    );
  }

  await persistIntegrationStatus({
    externalId: body.order_number,
    failed: result.failed,
    failureKind: result.failed > 0 ? "partial_failure" : "success",
    lastError,
    lastResult: result.failed > 0 ? "partial" : "succeeded",
    lineItems: body.line_items.length,
    operatorAction:
      result.failed > 0
        ? "Review the latest ShipHero integration error, confirm SKU mappings and credentials, then replay the shipment fixture if the provider does not retry automatically."
        : "No retry required. The shipment update applied successfully.",
    retryCommand:
      result.failed > 0 ? getReplayCommand(body.webhook_type) : null,
    retryMode: result.failed > 0 ? "provider_retry" : "none",
    retryRecommended: result.failed > 0,
    succeeded: result.succeeded,
    webhookType: body.webhook_type,
  });

  return NextResponse.json(
    {
      message: "Shipment synced",
      verified: true,
      retryStrategy: {
        operatorAction:
          result.failed > 0
            ? "Review the latest ShipHero integration error, confirm SKU mappings and credentials, then replay the shipment fixture if the provider does not retry automatically."
            : "No retry required. The shipment update applied successfully.",
        retryCommand:
          result.failed > 0 ? getReplayCommand(body.webhook_type) : null,
        retryMode: result.failed > 0 ? "provider_retry" : "none",
        retryRecommended: result.failed > 0,
      },
      tenantId,
      webhookType: body.webhook_type,
      lineItems: body.line_items.length,
      tracking: body.tracking_number,
      ...result,
    },
    { status: 200 },
  );
}
