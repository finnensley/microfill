import { useCallback, useEffect, useState } from "react";
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
  const fetchInventory = useCallback(async () => {
    if (!tenantId) {
      setItems([]);
      setError(
        "No tenant is configured for this account yet. Set DEFAULT_TENANT_ID locally or assign app_metadata.tenant_id to the user.",
      );
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/inventory?tenantId=${tenantId}`);
      const payload = (await response.json()) as {
        error?: string;
        items?: InventoryItem[];
      };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load inventory");
      }

      setItems(payload.items || []);
      setError(null);
    } catch (err) {
      console.error("Error fetching inventory:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

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
  }, [fetchInventory]);

  return { items, loading, error, refresh: fetchInventory };
}
