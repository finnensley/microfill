import { Database } from "@/types/supabase";

export type InventoryItem =
  Database["public"]["Tables"]["inventory_items"]["Row"];

export type AuditLogRow = Database["public"]["Tables"]["audit_logs"]["Row"];

export type InventoryAuditEntry = AuditLogRow & {
  itemLabel: string | null;
  itemProductId: string | null;
  itemSku: string | null;
};
