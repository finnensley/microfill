import { NextResponse } from "next/server";
import { resolveIntegration } from "@/services/integrations";
import { enqueueWebhookEvent } from "@/services/webhook-queue";
import { shopifyAdapter } from "@/services/wms-adapters/shopify";

/**
 * Shopify Webhook Handler (queue-backed)
 *
 * 1. Verifies the HMAC signature using the Shopify adapter.
 * 2. Enqueues the verified raw payload for async processing.
 * 3. Returns 2xx immediately — no inline inventory mutations.
 *
 * The queue worker at /api/queue/process handles normalization,
 * inventory sync (increment_committed_quantity), retry, and dead-letter logic.
 */
export async function POST(req: Request) {
  try {
    const shopId = req.headers.get("x-shopify-shop-id");
    const shopDomain = req.headers.get("x-shopify-shop-domain");
    const tenantHeader = req.headers.get("x-tenant-id");
    const providerMessageId = req.headers.get("x-shopify-webhook-id");
    const shopifyTopic = req.headers.get("x-shopify-topic");

    if (!shopId && !shopDomain && !tenantHeader) {
      console.error("Missing Shopify source headers");
      return NextResponse.json(
        { error: "Invalid webhook source" },
        { status: 400 },
      );
    }

    const rawBody = await req.text();
    const hmacHeader = req.headers.get(shopifyAdapter.hmacHeader)?.trim();

    if (!hmacHeader) {
      console.error("Missing Shopify HMAC header");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let integration = null;
    try {
      integration = await resolveIntegration({
        provider: "shopify",
        tenantId: tenantHeader,
        externalAccountId: shopId,
        externalShopDomain: shopDomain,
      });
    } catch (err) {
      console.warn(
        "Shopify integration lookup failed, proceeding with env fallback",
        err,
      );
    }

    const resolvedTenantId = integration?.tenant_id ?? tenantHeader ?? shopId;
    const webhookSecret =
      integration?.webhook_secret ??
      process.env[shopifyAdapter.getEnvSecretKey()] ??
      null;

    if (!webhookSecret) {
      console.error("No webhook secret available to verify Shopify signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!shopifyAdapter.verifySignature(rawBody, webhookSecret, hmacHeader)) {
      console.error("Invalid Shopify webhook signature", {
        tenantId: resolvedTenantId,
        shopId,
        shopDomain,
        hasIntegration: Boolean(integration),
        receivedSignaturePrefix: hmacHeader.slice(0, 8),
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!resolvedTenantId) {
      console.error("Unable to resolve tenant for Shopify webhook");
      return NextResponse.json(
        { error: "Invalid webhook source" },
        { status: 400 },
      );
    }

    // Quick parse for queue metadata (no inventory mutation here)
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 },
      );
    }

    const eventType = shopifyTopic ?? "orders/create";
    const externalId =
      typeof parsedBody.id === "string" || typeof parsedBody.id === "number"
        ? String(parsedBody.id)
        : null;

    const event = await enqueueWebhookEvent({
      tenant_id: resolvedTenantId,
      integration_id: integration?.id ?? null,
      provider: "shopify",
      event_type: eventType,
      external_id: externalId,
      provider_message_id: providerMessageId,
      payload: parsedBody,
    });

    console.info("Shopify webhook enqueued", {
      eventId: event.id,
      tenantId: resolvedTenantId,
      shopId,
      shopDomain,
      eventType,
      externalId,
    });

    return NextResponse.json(
      { eventId: event.id, queued: true, verified: true },
      { status: 202 },
    );
  } catch (err) {
    console.error("Shopify webhook error:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

/**
 * Shopify HEAD probe — used by Shopify to verify the endpoint is reachable
 * before registering the webhook subscription.
 */
export function HEAD() {
  return new Response(null, { status: 200 });
}
