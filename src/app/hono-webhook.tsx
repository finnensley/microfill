import { Hono } from 'hono'
import { createClient } from '@supabase/supabase-js'

const app = new Hono()
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// This endpoint listens for Shopify "orders/create" webhooks
app.post('/webhook/shopify/order', async (c) => {
  const body = await c.req.json()
  
  // 1. Extract the SKU and Quantity from the Shopify Order
  const lineItems = body.line_items 

  for (const item of lineItems) {
    const sku = item.sku
    const quantitySold = item.fulfillable_quantity

    // 2. Update your PostgreSQL database (The "P" in PERN)
    // We use a "RPC" or a direct update to decrement the physical count
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, physical_quantity, products!inner(sku)')
      .eq('products.sku', sku)
      .single()

    if (data) {
      const newQty = data.physical_quantity - quantitySold
      
      await supabase
        .from('inventory_items')
        .update({ physical_quantity: newQty })
        .eq('id', data.id)
        
      console.log(`Successfully synced SKU: ${sku}. New qty: ${newQty}`)
    }
  }

  return c.json({ received: true }, 200)
})

export default app