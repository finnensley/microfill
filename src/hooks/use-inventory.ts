import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import { InventoryItem } from "@/types/inventory";

/**
 * Hook to fetch and subscribe to inventory items
 * Supports optional tenant_id filtering for multi-tenant setups
 * TODO: Extract tenant_id from auth context automatically
 */
export function useInventory(tenantId?: string) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Initial Fetch
  const fetchInventory = async () => {
    try {
      setLoading(true);
      let query = supabase.from("inventory_items").select("*");

      if (tenantId) {
        query = query.eq("tenant_id", tenantId);
      }

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;

      setItems((data || []) as InventoryItem[]);
      setError(null);
    } catch (err) {
      console.error("Error fetching inventory:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // 2. Real-time Subscription
  useEffect(() => {
    fetchInventory();

    // TODO: Re-enable real-time subscriptions with updated Supabase API
    // For now, refresh on mount. In production, use:
    // const channel = supabase.channel('inventory-updates')
    //   .on('postgres_changes', { event: '*', table: 'inventory_items' }, () => {
    //     fetchInventory();
    //   })
    //   .subscribe();
    // return () => { supabase.removeChannel(channel); }

    return () => {
      // Cleanup
    };
  }, [tenantId]);

  return { items, loading, error, refresh: fetchInventory };
}
