import { NextResponse } from "next/server";
import crypto from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getShopifyWebhookSecret } from "@/lib/supabase-config";

type ShopifyWebhookLineItem = {
  quantity: number;
  variant_id: number | string;
};

type ShopifyWebhookOrder = {
  id: number | string;
  line_items?: ShopifyWebhookLineItem[];
};

export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const shopifyWebhookSecret = getShopifyWebhookSecret();

    // 1. Extract tenant_id from Shopify shop ID (multi-tenancy support)
    const shopId = req.headers.get("x-shopify-shop-id");
    if (!shopId) {
      console.error("Missing Shopify Shop ID header");
      return NextResponse.json(
        { error: "Invalid webhook source" },
        { status: 400 },
      );
    }

    // 2. Get the raw body as text for HMAC verification
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256");

    // 3. Verify HMAC signature - Prevent unauthorized webhook calls
    if (!hmacHeader) {
      console.error("Missing Shopify HMAC header");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const generatedHash = crypto
      .createHmac("sha256", shopifyWebhookSecret)
      .update(rawBody, "utf8")
      .digest("base64");

    // 4. Security Check: Compare hashes
    if (generatedHash !== hmacHeader) {
      console.error("Invalid Webhook Signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 5. If valid, parse the JSON and update inventory
    const body = JSON.parse(rawBody) as ShopifyWebhookOrder;
    const { line_items, id: orderId } = body;

    if (!line_items || line_items.length === 0) {
      return NextResponse.json(
        { received: true, verified: true },
        { status: 200 },
      );
    }

    // Process each item in the Shopify order
    for (const item of line_items) {
      const variantId = item.variant_id.toString();
      const quantitySold = item.quantity;

      // Get inventory item by Shopify variant ID AND tenant_id (multi-tenancy)
      const { data: inventoryItem, error: lookupError } = await supabase
        .from("inventory_items")
        .select("id")
        .eq("tenant_id", shopId)
        .eq("shopify_variant_id", variantId)
        .single();

      if (lookupError || !inventoryItem) {
        console.warn(
          `Inventory item not found for tenant ${shopId} variant ${variantId}`,
        );
        continue;
      }

      // Atomically increment committed quantity using database function
      // This prevents race conditions even under extreme concurrent load
      // See: supabase/migrations/20260324024110_init_schema.sql for details
      const { error: syncError } = await supabase.rpc(
        "increment_committed_quantity",
        {
          tenant_id_input: shopId,
          item_id: inventoryItem.id,
          amount: quantitySold,
        },
      );

      if (syncError) {
        console.error(`Error syncing variant ${variantId}:`, syncError);
      }
    }

    return NextResponse.json(
      { received: true, verified: true, orderId },
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
