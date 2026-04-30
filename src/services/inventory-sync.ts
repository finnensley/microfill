import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { WmsProvider } from "@/services/wms-adapters/types";

/**
 * Normalized inventory event - works for ANY WMS.
 * Keeps webhook handlers simple and centralizes business logic.
 */
export interface InventoryEvent {
  type: "stock_received" | "stock_shipped";
  sku: string;
  quantity: number;
  source: WmsProvider;
  externalId: string; // WMS order/PO number for audit trail
  tenantId: string; // Required for multi-tenancy
  timestamp?: Date;
}

type ReceivingRpcArgs = {
  qty_received: number;
  sku_input: string;
  tenant_id_input: string;
};

type ShipmentRpcArgs = {
  qty_shipped: number;
  sku_input: string;
  tenant_id_input: string;
};

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
    const supabase = createServerSupabaseClient();

    if (event.type === "stock_received") {
      const receivingArgs: ReceivingRpcArgs = {
        tenant_id_input: event.tenantId,
        sku_input: event.sku,
        qty_received: event.quantity,
      };
      const { error } = await supabase.rpc(
        "sync_wms_stock_received",
        receivingArgs,
      );

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
      const shipmentArgs: ShipmentRpcArgs = {
        tenant_id_input: event.tenantId,
        sku_input: event.sku,
        qty_shipped: event.quantity,
      };
      const { error } = await supabase.rpc(
        "sync_wms_stock_shipped",
        shipmentArgs,
      );

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
