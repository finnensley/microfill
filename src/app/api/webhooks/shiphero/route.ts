import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getRequiredEnv } from "@/lib/supabase-config";
import { resolveIntegration } from "@/services/integrations";
import { enqueueWebhookEvent } from "@/services/webhook-queue";
import { shipHeroAdapter } from "@/services/wms-adapters/shiphero";
import type { WmsAdapter } from "@/services/wms-adapters/types";

function normalizeIntegrationConfig(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {} as Record<string, unknown>;
  }
  return config as Record<string, unknown>;
}

function resolveHmacHeader(
  req: Request,
  adapter: WmsAdapter,
): string | undefined {
  const primary = req.headers.get(adapter.hmacHeader)?.trim();
  if (primary) return primary;
  for (const fallback of adapter.hmacFallbackHeaders ?? []) {
    const value = req.headers.get(fallback)?.trim();
    if (value) return value;
  }
  return undefined;
}

export function HEAD() {
  return new NextResponse(null, { status: 200 });
}

/**
 * ShipHero Webhook Handler (queue-backed)
 *
 * 1. Verifies the HMAC signature using the ShipHero adapter.
 * 2. Enqueues the verified raw payload for async processing.
 * 3. Returns 2xx immediately — no inline inventory mutations.
 *
 * The queue worker at /api/queue/process handles normalization,
 * inventory sync, retry, and dead-letter logic.
 */
export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const tenantHeader = req.headers.get("x-tenant-id");
    const shopIdHeader = req.headers.get("x-shopify-shop-id");
    const shipHeroAccountId = req.headers.get("x-shiphero-account-id");
    const providerMessageId = req.headers.get("x-shiphero-message-id");

    const rawBody = await req.text();
    const hmacHeader = resolveHmacHeader(req, shipHeroAdapter);

    if (!hmacHeader) {
      console.error("Missing ShipHero HMAC header");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bodyAccountId = shipHeroAdapter.getExternalAccountId(rawBody);

    let integration = null;
    try {
      integration = await resolveIntegration({
        provider: "shiphero",
        tenantId: tenantHeader,
        externalAccountId: shipHeroAccountId ?? shopIdHeader ?? bodyAccountId,
      });
    } catch (err) {
      console.warn(
        "ShipHero integration lookup failed, proceeding with env fallback",
        err,
      );
    }

    const resolvedTenantId =
      integration?.tenant_id ?? tenantHeader ?? shopIdHeader;
    const webhookSecret =
      integration?.webhook_secret ??
      process.env[shipHeroAdapter.getEnvSecretKey()] ??
      null;

    if (!resolvedTenantId) {
      console.error("Unable to resolve tenant for ShipHero webhook");
      return NextResponse.json(
        { error: "Missing tenant identifier" },
        { status: 400 },
      );
    }

    if (!webhookSecret) {
      console.error("No webhook secret available to verify ShipHero signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!shipHeroAdapter.verifySignature(rawBody, webhookSecret, hmacHeader)) {
      // Persist invalid-signature event so operators can diagnose from the dashboard
      if (integration?.id) {
        const currentConfig = normalizeIntegrationConfig(integration.config);
        await supabase
          .from("integrations")
          .update({
            config: {
              ...currentConfig,
              shipheroWebhookStatus: {
                failureKind: "invalid_signature",
                lastAttemptAt: new Date().toISOString(),
                lastError: `Invalid ShipHero webhook signature for ${shipHeroAccountId ?? resolvedTenantId}`,
                lastResult: "failed",
                operatorAction:
                  "Confirm the ShipHero webhook secret and account ID match the provider, then rerun the ShipHero smoke test.",
                retryMode: "fix_configuration",
                retryRecommended: false,
              },
            },
            last_error: `Invalid ShipHero webhook signature for ${shipHeroAccountId ?? resolvedTenantId}`,
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", integration.id)
          .eq("tenant_id", integration.tenant_id);
      }

      console.error("Invalid ShipHero webhook signature", {
        tenantId: resolvedTenantId,
        shipHeroAccountId,
        hasIntegration: Boolean(integration),
        receivedSignaturePrefix: hmacHeader.slice(0, 8),
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Quick parse to get event type and external ID for the queue record.
    // Full normalization + inventory mutation happens in the worker.
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 },
      );
    }

    const { eventType, externalId } = shipHeroAdapter.normalize(
      rawBody,
      resolvedTenantId,
    );

    // Return early for unrecognised event types without enqueuing
    if (
      eventType !== null &&
      !shipHeroAdapter.knownEventTypes.includes(eventType)
    ) {
      console.warn("ShipHero webhook type not handled", {
        eventType,
        tenantId: resolvedTenantId,
      });
      return NextResponse.json(
        {
          message: "Webhook type not handled",
          verified: true,
          webhookType: eventType,
        },
        { status: 200 },
      );
    }

    const queuedEvent = await enqueueWebhookEvent({
      tenant_id: resolvedTenantId,
      integration_id: integration?.id ?? null,
      provider: "shiphero",
      event_type: eventType,
      external_id: externalId,
      provider_message_id: providerMessageId,
      payload: parsedBody,
    });

    // Record successful receipt on integration for dashboard visibility
    if (integration?.id) {
      await supabase
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq("id", integration.id)
        .eq("tenant_id", integration.tenant_id);
    }

    console.info("ShipHero webhook queued", {
      eventId: queuedEvent.id,
      tenantId: resolvedTenantId,
      eventType,
      externalId,
    });

    return NextResponse.json(
      {
        eventId: queuedEvent.id,
        eventType,
        provider: "shiphero",
        queued: true,
        verified: true,
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
