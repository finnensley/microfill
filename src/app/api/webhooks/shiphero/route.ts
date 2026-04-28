import { NextResponse } from "next/server";
import crypto from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getShipHeroWebhookSecret } from "@/lib/supabase-config";
import { resolveIntegration } from "@/services/integrations";
import { ShipHeroPOUpdate, ShipHeroShipmentUpdate } from "@/types/shiphero";
import {
  processSyncEventsBatch,
  InventoryEvent,
} from "@/services/inventory-sync";

type PersistIntegrationStatus = (lastError: string | null) => Promise<void>;

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

    if (!tenantHeader && !shopIdHeader && !shipHeroAccountId) {
      console.error("Missing tenant or integration identifier header");
      return NextResponse.json(
        { error: "Missing tenant identifier" },
        { status: 400 },
      );
    }

    // 2. Get raw body for HMAC verification
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shiphero-webhook-signature")?.trim();

    // 3. Verify HMAC signature - Prevent unauthorized webhook calls
    if (!hmacHeader) {
      console.error("Missing ShipHero HMAC header");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const integration = await resolveIntegration({
      provider: "shiphero",
      tenantId: tenantHeader,
      externalAccountId: shipHeroAccountId ?? shopIdHeader,
    });

    const persistIntegrationStatus: PersistIntegrationStatus = async (
      lastError,
    ) => {
      if (!integration?.id) {
        return;
      }

      const { error } = await supabase
        .from("integrations")
        .update({
          last_error: lastError,
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
      await persistIntegrationStatus(
        `Invalid ShipHero webhook signature for ${shipHeroAccountId ?? resolvedTenantId}`,
      );
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
    const body = JSON.parse(rawBody);

    if (body.webhook_type === "PO Update") {
      return handlePOUpdate(
        body as ShipHeroPOUpdate,
        resolvedTenantId,
        persistIntegrationStatus,
        shipHeroAccountId,
      );
    } else if (body.webhook_type === "Shipment Update") {
      return handleShipmentUpdate(
        body as ShipHeroShipmentUpdate,
        resolvedTenantId,
        persistIntegrationStatus,
        shipHeroAccountId,
      );
    }

    await persistIntegrationStatus(null);

    return NextResponse.json(
      {
        message: "Webhook type not handled",
        verified: true,
        webhookType: body.webhook_type ?? null,
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
    await persistIntegrationStatus(null);
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

  await persistIntegrationStatus(
    buildWebhookStatusMessage({
      externalId: body.po_number,
      failed: result.failed,
      lineItems: body.line_items.length,
      succeeded: result.succeeded,
      webhookType: body.webhook_type,
    }),
  );

  return NextResponse.json(
    {
      message: "PO synced",
      verified: true,
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
    await persistIntegrationStatus(null);
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

  await persistIntegrationStatus(
    buildWebhookStatusMessage({
      externalId: body.order_number,
      failed: result.failed,
      lineItems: body.line_items.length,
      succeeded: result.succeeded,
      webhookType: body.webhook_type,
    }),
  );

  return NextResponse.json(
    {
      message: "Shipment synced",
      verified: true,
      tenantId,
      webhookType: body.webhook_type,
      lineItems: body.line_items.length,
      tracking: body.tracking_number,
      ...result,
    },
    { status: 200 },
  );
}
