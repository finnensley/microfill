import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase-client';

// Your Shopify Webhook Secret from Shopify Admin Settings
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  try {
    // 1. Get the raw body as text for HMAC verification
    const rawBody = await req.text();
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256');

    // 2. Verify HMAC signature - Prevent unauthorized webhook calls
    if (!hmacHeader) {
      console.error('Missing Shopify HMAC header');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const generatedHash = crypto
      .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
      .update(rawBody, 'utf8')
      .digest('base64');

    // 3. Security Check: Compare hashes
    if (generatedHash !== hmacHeader) {
      console.error('Invalid Webhook Signature');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 4. If valid, parse the JSON and update inventory
    const body = JSON.parse(rawBody);
    const { line_items, id: orderId } = body;

    if (!line_items || line_items.length === 0) {
      return NextResponse.json({ received: true, verified: true }, { status: 200 });
    }

    // Process each item in the Shopify order
    for (const item of line_items) {
      const variantId = item.variant_id.toString();
      const quantitySold = item.quantity;

      // Get inventory item by Shopify variant ID
      const { data: inventoryItem, error: lookupError } = await supabase
        .from('inventory_items')
        .select('id')
        .eq('shopify_variant_id', variantId)
        .single();

      if (lookupError || !inventoryItem) {
        console.warn(`Inventory item not found for variant ${variantId}`);
        continue;
      }

      // Atomically increment committed quantity using database function
      const { error: syncError } = await supabase.rpc(
        'increment_committed_quantity',
        {
          item_id: inventoryItem.id,
          amount: quantitySold
        }
      );

      if (syncError) {
        console.error(`Error syncing variant ${variantId}:`, syncError);
      }
    }

    return NextResponse.json({ received: true, verified: true, orderId }, { status: 200 });
  } catch (err) {
    console.error('Webhook Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
  }
}
