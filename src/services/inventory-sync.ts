import { supabase } from "@/lib/supabase-client";

/**
 * Normalized inventory event - works for ANY WMS
 * Keeps webhook handlers simple, centralizes business logic
 */
export interface InventoryEvent {
  type: "stock_received" | "stock_shipped";
  sku: string;
  quantity: number;
  source: "shopify" | "shiphero" | "fishbowl" | "netsuite"; // Track WMS origin
  externalId: string; // WMS order/PO number for audit trail
  tenantId: string; // Required for multi-tenancy: Shopify shop_id, warehouse_id, etc.
  timestamp?: Date;
}

/**
 * Process normalized inventory events
 * Single source of truth for inventory sync logic
 *
 * stock_received: Increment total_quantity (new stock arrived)
 * stock_shipped: Decrement total_quantity (units shipped out)
 */
export async function processSyncEvent(
  event: InventoryEvent,
): Promise<boolean> {
  try {
    if (event.type === "stock_received") {
      const { error } = await supabase.rpc("sync_shiphero_receiving", {
        tenant_id_input: event.tenantId,
        sku_input: event.sku,
        qty_received: event.quantity,
      });

      if (error) {
        console.error(
          `[${event.source}] Error receiving stock for SKU ${event.sku}:`,
          error,
        );
        return false;
      }

      console.log(
        `✓ [${event.source}] Stock received: ${event.sku} +${event.quantity} (${event.externalId})`,
      );
      return true;
    }

    if (event.type === "stock_shipped") {
      const { error } = await supabase.rpc("sync_shiphero_shipment", {
        tenant_id_input: event.tenantId,
        sku_input: event.sku,
        qty_shipped: event.quantity,
      });

      if (error) {
        console.error(
          `[${event.source}] Error shipping stock for SKU ${event.sku}:`,
          error,
        );
        return false;
      }

      console.log(
        `✓ [${event.source}] Stock shipped: ${event.sku} -${event.quantity} (${event.externalId})`,
      );
      return true;
    }

    console.warn(`Unknown event type: ${event.type}`);
    return false;
  } catch (err) {
    console.error(`[${event.source}] Sync error:`, err);
    return false;
  }
}

/**
 * Process multiple inventory events in batch
 * Useful for webhooks that contain multiple line items
 */
export async function processSyncEventsBatch(
  events: InventoryEvent[],
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (const event of events) {
    const result = await processSyncEvent(event);
    if (result) {
      succeeded++;
    } else {
      failed++;
    }
  }

  console.log(`Batch complete: ${succeeded} succeeded, ${failed} failed`);
  return { succeeded, failed };
}
