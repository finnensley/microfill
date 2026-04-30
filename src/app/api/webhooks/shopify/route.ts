import { NextResponse } from "next/server";
import crypto from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { resolveIntegration } from "@/services/integrations";

type ShopifyWebhookLineItem = {
  quantity: number;
  variant_id: number | string | null;
};

type ShopifyLineResult = {
  inventoryItemId?: string;
  quantity: number;
  reason?: string;
  status: "processed" | "skipped" | "failed";
  variantId: string | null;
};

type ShopifyWebhookOrder = {
  id: number | string;
  line_items?: ShopifyWebhookLineItem[];
};

function summarizeLineResults(lineResults: ShopifyLineResult[]) {
  return lineResults
    .map((lineResult) => {
      const base = `${lineResult.status}:${lineResult.variantId ?? "none"}x${lineResult.quantity}`;
      return lineResult.reason ? `${base}:${lineResult.reason}` : base;
    })
    .join(", ");
}

function buildWebhookStatusMessage(params: {
  failed: number;
  lineResults: ShopifyLineResult[];
  orderId: number | string;
  processed: number;
  skipped: number;
}) {
  const summary = `order=${params.orderId} processed=${params.processed} skipped=${params.skipped} failed=${params.failed}`;

  if (params.failed === 0 && params.skipped === 0) {
    return null;
  }

  const lineSummary = summarizeLineResults(params.lineResults);
  return lineSummary ? `${summary} lines=${lineSummary}` : summary;
}

export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const lineResults: ShopifyLineResult[] = [];

    const shopId = req.headers.get("x-shopify-shop-id");
    const shopDomain = req.headers.get("x-shopify-shop-domain");
    const tenantHeader = req.headers.get("x-tenant-id");

    if (!shopId && !shopDomain && !tenantHeader) {
      console.error("Missing Shopify Shop ID header");
      return NextResponse.json(
        { error: "Invalid webhook source" },
        { status: 400 },
      );
    }

    // 2. Get the raw body as text for HMAC verification
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256")?.trim();

    // 3. Verify HMAC signature - Prevent unauthorized webhook calls
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
    const shopifyWebhookSecret =
      integration?.webhook_secret ??
      process.env["SHOPIFY_WEBHOOK_SECRET"] ??
      null;

    if (!shopifyWebhookSecret) {
      console.error("No webhook secret available to verify Shopify signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const persistIntegrationStatus = async (lastError: string | null) => {
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
        console.error("Unable to persist Shopify integration status", {
          error: error.message,
          integrationId: integration.id,
          tenantId: integration.tenant_id,
        });
      }
    };

    if (!resolvedTenantId) {
      console.error("Unable to resolve tenant for Shopify webhook");
      return NextResponse.json(
        { error: "Invalid webhook source" },
        { status: 400 },
      );
    }

    const generatedHash = crypto
      .createHmac("sha256", shopifyWebhookSecret)
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
        `Invalid Shopify webhook signature for ${shopDomain ?? shopId ?? resolvedTenantId}`,
      );
      console.error("Invalid Shopify webhook signature", {
        tenantId: resolvedTenantId,
        shopId,
        shopDomain,
        hasIntegration: Boolean(integration),
        receivedSignaturePrefix: hmacHeader.slice(0, 8),
        expectedSignaturePrefix: generatedHash.slice(0, 8),
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 5. If valid, parse the JSON and update inventory
    const body = JSON.parse(rawBody) as ShopifyWebhookOrder;
    const { line_items, id: orderId } = body;

    if (!line_items || line_items.length === 0) {
      await persistIntegrationStatus(null);
      return NextResponse.json(
        {
          failed,
          lineResults,
          processed,
          received: true,
          skipped,
          verified: true,
        },
        { status: 200 },
      );
    }

    // Process each item in the Shopify order
    for (const item of line_items) {
      if (
        item.variant_id === null ||
        item.variant_id === undefined ||
        item.variant_id === ""
      ) {
        console.warn("Skipping Shopify line item without a variant ID", {
          orderId,
          quantity: item.quantity,
          shopDomain,
          shopId,
          tenantId: resolvedTenantId,
        });
        lineResults.push({
          quantity: item.quantity,
          reason: "missing_variant_id",
          status: "skipped",
          variantId: null,
        });
        skipped++;
        continue;
      }

      const variantId = item.variant_id.toString();
      const quantitySold = item.quantity;

      // Get inventory item by Shopify variant ID AND tenant_id (multi-tenancy)
      const { data: inventoryItem, error: lookupError } = await supabase
        .from("inventory_items")
        .select("id")
        .eq("tenant_id", resolvedTenantId)
        .eq("shopify_variant_id", variantId)
        .single();

      if (lookupError || !inventoryItem) {
        console.warn(
          `Inventory item not found for tenant ${resolvedTenantId} variant ${variantId}`,
        );
        lineResults.push({
          quantity: quantitySold,
          reason: "inventory_item_not_found",
          status: "skipped",
          variantId,
        });
        skipped++;
        continue;
      }

      // Atomically increment committed quantity using database function
      // This prevents race conditions even under extreme concurrent load
      // See: supabase/migrations/20260324024110_init_schema.sql for details
      const { error: syncError } = await supabase.rpc(
        "increment_committed_quantity",
        {
          tenant_id_input: resolvedTenantId,
          item_id: inventoryItem.id,
          amount: quantitySold,
        },
      );

      if (syncError) {
        console.error(`Error syncing variant ${variantId}:`, syncError);
        lineResults.push({
          inventoryItemId: inventoryItem.id,
          quantity: quantitySold,
          reason: syncError.message,
          status: "failed",
          variantId,
        });
        failed++;
        continue;
      }

      lineResults.push({
        inventoryItemId: inventoryItem.id,
        quantity: quantitySold,
        status: "processed",
        variantId,
      });
      processed++;
    }

    console.info("Processed Shopify webhook", {
      lineResults,
      tenantId: resolvedTenantId,
      shopId,
      shopDomain,
      orderId,
      processed,
      skipped,
      failed,
    });

    await persistIntegrationStatus(
      buildWebhookStatusMessage({
        failed,
        lineResults,
        orderId,
        processed,
        skipped,
      }),
    );

    return NextResponse.json(
      {
        failed,
        lineResults,
        orderId,
        processed,
        received: true,
        skipped,
        verified: true,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("Webhook Error:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
