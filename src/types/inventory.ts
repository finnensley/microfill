import { Database } from "@/types/supabase";

export type InventoryItem =
  Database["public"]["Tables"]["inventory_items"]["Row"];

export interface AuditLog {
  id: string;
  inventory_id: string;
  action_type: "ORDER_COMMITTED" | "PHYSICAL_SHIPMENT" | "MANUAL_ADJUST";
  user_id: string;
  created_at: string;
}
