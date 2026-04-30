import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getRequiredEnv } from "@/lib/supabase-config";
import { resolveIntegration } from "@/services/integrations";
import { processSyncEventsBatch } from "@/services/inventory-sync";
import { shipHeroAdapter } from "@/services/wms-adapters/shiphero";
import type { WmsAdapter } from "@/services/wms-adapters/types";

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

function normalizeIntegrationConfig(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {} as Record<string, unknown>;
  }

  return config as Record<string, unknown>;
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

function resolveHmacHeader(
  req: Request,
  adapter: WmsAdapter,
): string | undefined {
  const primary = req.headers.get(adapter.hmacHeader)?.trim();
  if (primary) {
    return primary;
  }
  for (const fallback of adapter.hmacFallbackHeaders ?? []) {
    const value = req.headers.get(fallback)?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function HEAD() {
  return new NextResponse(null, { status: 200 });
}

/**
 * ShipHero Webhook Handler
 *
 * Delegates HMAC verification and payload normalization to the ShipHero adapter.
 * The inventory sync logic is shared across all WMS providers via processSyncEventsBatch.
 * To add a new WMS: implement WmsAdapter, register it, and create a matching route file.
 */
export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const tenantHeader = req.headers.get("x-tenant-id");
    const shopIdHeader = req.headers.get("x-shopify-shop-id");
    const shipHeroAccountId = req.headers.get("x-shiphero-account-id");

    const rawBody = await req.text();

    // Resolve HMAC header using adapter-configured header names
    const hmacHeader = resolveHmacHeader(req, shipHeroAdapter);

    if (!hmacHeader) {
      console.error("Missing ShipHero HMAC header");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extract external account ID from body for integration lookup (pre-verification)
    const bodyAccountId = shipHeroAdapter.getExternalAccountId(rawBody);

    const integration = await resolveIntegration({
      provider: "shiphero",
      tenantId: tenantHeader,
      externalAccountId: shipHeroAccountId ?? shopIdHeader ?? bodyAccountId,
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
    const webhookSecret =
      integration?.webhook_secret ??
      getRequiredEnv(shipHeroAdapter.getEnvSecretKey());

    if (!resolvedTenantId) {
      console.error("Unable to resolve tenant for ShipHero webhook");
      return NextResponse.json(
        { error: "Missing tenant identifier" },
        { status: 400 },
      );
    }

    // Verify HMAC signature using adapter — prevents unauthorized webhook calls
    if (!shipHeroAdapter.verifySignature(rawBody, webhookSecret, hmacHeader)) {
      await persistIntegrationStatus({
        failed: 1,
        failureKind: "invalid_signature",
        lastError: `Invalid ShipHero webhook signature for ${shipHeroAccountId ?? resolvedTenantId}`,
        lastResult: "failed",
        operatorAction:
          "Confirm the ShipHero webhook secret and account ID match the provider, then rerun the ShipHero smoke test before replaying the event.",
        retryCommand: null,
        retryMode: "fix_configuration",
        retryRecommended: false,
        succeeded: 0,
      });
      console.error("Invalid ShipHero webhook signature", {
        tenantId: resolvedTenantId,
        shipHeroAccountId,
        shopIdHeader,
        hasIntegration: Boolean(integration),
        receivedSignaturePrefix: hmacHeader.slice(0, 8),
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Normalize payload using the adapter — only after signature is verified
    const { events, eventType, externalId, lineItemCount, responseContext } =
      shipHeroAdapter.normalize(rawBody, resolvedTenantId);

    // Handle unsupported webhook types
    if (
      eventType !== null &&
      !shipHeroAdapter.knownEventTypes.includes(eventType)
    ) {
      await persistIntegrationStatus({
        externalId,
        failed: 0,
        failureKind: "unsupported_type",
        lastError: `Unsupported ShipHero webhook type: ${eventType}`,
        lastResult: "ignored",
        lineItems: lineItemCount,
        operatorAction:
          "No retry is required unless this webhook type should be supported by the application.",
        retryCommand: null,
        retryMode: "manual_review",
        retryRecommended: false,
        succeeded: 0,
        webhookType: eventType,
      });

      console.warn("ShipHero webhook type not handled", {
        externalId,
        lineItems: lineItemCount,
        tenantId: resolvedTenantId,
        webhookType: eventType,
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
          webhookType: eventType,
        },
        { status: 200 },
      );
    }

    // Handle payloads with no processable line items
    const noItemsAction =
      eventType === "PO Update"
        ? "No retry is required because the webhook did not include any PO line items."
        : "No retry is required because the webhook did not include any shipment line items.";

    if (events.length === 0) {
      await persistIntegrationStatus({
        externalId,
        failed: 0,
        failureKind: "no_items",
        lastError: null,
        lastResult: "ignored",
        lineItems: 0,
        operatorAction: noItemsAction,
        retryCommand: null,
        retryMode: "none",
        retryRecommended: false,
        succeeded: 0,
        webhookType: eventType,
      });
      return NextResponse.json(
        {
          message: "No items to process",
          tenantId: resolvedTenantId,
          verified: true,
          webhookType: eventType,
        },
        { status: 200 },
      );
    }

    // Process normalized events through the shared inventory sync service
    const result = await processSyncEventsBatch(events);

    console.info("Processed ShipHero webhook", {
      tenantId: resolvedTenantId,
      shipHeroAccountId: shipHeroAccountId ?? null,
      externalId,
      lineItems: lineItemCount,
      webhookType: eventType,
      ...result,
    });

    const lastError = buildWebhookStatusMessage({
      externalId: externalId ?? "",
      failed: result.failed,
      lineItems: lineItemCount,
      succeeded: result.succeeded,
      webhookType: eventType ?? "",
    });

    if (result.failed > 0) {
      console.error("ShipHero webhook had failed inventory sync events", {
        tenantId: resolvedTenantId,
        shipHeroAccountId: shipHeroAccountId ?? null,
        externalId,
        webhookType: eventType,
        retryCommand: shipHeroAdapter.getReplayCommand(eventType ?? null),
        ...result,
      });
    }

    const operatorAction =
      result.failed > 0
        ? eventType === "PO Update"
          ? "Review the latest ShipHero integration error, confirm SKU mappings and credentials, then replay the PO fixture if the provider does not retry automatically."
          : "Review the latest ShipHero integration error, confirm SKU mappings and credentials, then replay the shipment fixture if the provider does not retry automatically."
        : eventType === "PO Update"
          ? "No retry required. The PO update applied successfully."
          : "No retry required. The shipment update applied successfully.";

    await persistIntegrationStatus({
      externalId,
      failed: result.failed,
      failureKind: result.failed > 0 ? "partial_failure" : "success",
      lastError,
      lastResult: result.failed > 0 ? "partial" : "succeeded",
      lineItems: lineItemCount,
      operatorAction,
      retryCommand:
        result.failed > 0
          ? shipHeroAdapter.getReplayCommand(eventType ?? null)
          : null,
      retryMode: result.failed > 0 ? "provider_retry" : "none",
      retryRecommended: result.failed > 0,
      succeeded: result.succeeded,
      webhookType: eventType,
    });

    const message = eventType === "PO Update" ? "PO synced" : "Shipment synced";

    return NextResponse.json(
      {
        message,
        verified: true,
        retryStrategy: {
          operatorAction,
          retryCommand:
            result.failed > 0
              ? shipHeroAdapter.getReplayCommand(eventType ?? null)
              : null,
          retryMode: result.failed > 0 ? "provider_retry" : "none",
          retryRecommended: result.failed > 0,
        },
        tenantId: resolvedTenantId,
        webhookType: eventType,
        lineItems: lineItemCount,
        ...responseContext,
        ...result,
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
