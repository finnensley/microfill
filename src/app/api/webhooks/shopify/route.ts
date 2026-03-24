import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { line_items } = body;

    // 1. Loop through each item in the Shopify Order
    for (const item of line_items) {
      const sku = item.sku;
      const quantitySold = item.quantity;

      // 2. Call our PostgreSQL function 'sync_new_order' 
      // This increases 'committed_quantity' and updates 'available_to_sell'
      const { error } = await supabase.rpc('sync_new_order', { 
        sku_input: sku, 
        qty_sold: quantitySold 
      });

      if (error) console.error(`Error syncing SKU ${sku}:`, error);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error('Webhook Error:', err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}