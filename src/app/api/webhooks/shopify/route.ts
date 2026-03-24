import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { supabase } from "@/lib/supabase-client";

/**
 * Verify Shopify webhook HMAC signature
 * Prevents unauthorized webhook calls
 */
function verifyShopifyHmac(req: Request, body: string): boolean {
  const hmacHeader = req.headers.get("X-Shopify-Hmac-SHA256");
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!hmacHeader || !secret) {
    console.warn("Missing HMAC header or secret");
    return false;
  }

  const hash = createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");

  return hash === hmacHeader;
}

export async function POST(req: Request) {
  try {
    // Get raw body for HMAC verification
    const rawBody = await req.text();

    // Verify webhook signature
    if (!verifyShopifyHmac(req, rawBody)) {
      console.warn("Invalid Shopify webhook signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = JSON.parse(rawBody);
    const { line_items, id: orderId } = body;

    if (!line_items || line_items.length === 0) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Process each item in the Shopify order
    for (const item of line_items) {
      const variantId = item.variant_id.toString();
      const quantitySold = item.quantity;

      // Get inventory item by Shopify variant ID
      const { data: inventoryItem, error: lookupError } = await supabase
        .from("inventory_items")
        .select("id")
        .eq("shopify_variant_id", variantId)
        .single();

      if (lookupError || !inventoryItem) {
        console.warn(`Inventory item not found for variant ${variantId}`);
        continue;
      }

      // Atomically increment committed quantity
      const { error: syncError } = await supabase.rpc(
        "increment_committed_quantity",
        {
          item_id: inventoryItem.id,
          amount: quantitySold,
        },
      );

      if (syncError) {
        console.error(`Error syncing variant ${variantId}:`, syncError);
      }
    }

    return NextResponse.json({ received: true, orderId }, { status: 200 });
  } catch (err) {
    console.error("Webhook Error:", err);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    );
  }
}
