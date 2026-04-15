export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      inventory_items: {
        Row: {
          committed_quantity: number;
          created_at: string | null;
          flash_mode_enabled: boolean | null;
          id: string;
          last_synced_at: string | null;
          safety_floor_percent: number;
          safety_floor_quantity: number;
          shopify_product_id: string;
          shopify_variant_id: string;
          sku: string | null;
          tenant_id: string;
          total_quantity: number;
          updated_at: string | null;
        };
        Insert: {
          committed_quantity?: number;
          created_at?: string | null;
          flash_mode_enabled?: boolean | null;
          id?: string;
          last_synced_at?: string | null;
          safety_floor_percent?: number;
          safety_floor_quantity?: number;
          shopify_product_id: string;
          shopify_variant_id: string;
          sku?: string | null;
          tenant_id?: string;
          total_quantity?: number;
          updated_at?: string | null;
        };
        Update: {
          committed_quantity?: number;
          created_at?: string | null;
          flash_mode_enabled?: boolean | null;
          id?: string;
          last_synced_at?: string | null;
          safety_floor_percent?: number;
          safety_floor_quantity?: number;
          shopify_product_id?: string;
          shopify_variant_id?: string;
          sku?: string | null;
          tenant_id?: string;
          total_quantity?: number;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          created_at: string;
          email: string;
          id: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_available_quantity: {
        Args:
          | {
              item_id: string;
            }
          | {
              item_id: string;
              tenant_id_input: string;
            };
        Returns: number;
      };
      increment_committed_quantity: {
        Args:
          | {
              amount: number;
              item_id: string;
            }
          | {
              amount: number;
              item_id: string;
              tenant_id_input: string;
            };
        Returns: number;
      };
      sync_shiphero_receiving: {
        Args: {
          qty_received: number;
          sku_input: string;
          tenant_id_input: string;
        };
        Returns: void;
      };
      sync_shiphero_shipment: {
        Args: {
          qty_shipped: number;
          sku_input: string;
          tenant_id_input: string;
        };
        Returns: void;
      };
      update_inventory_timestamp: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      update_safety_floor: {
        Args: Record<string, never>;
        Returns: unknown;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
