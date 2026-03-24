import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { InventoryItem } from '@/types/inventory';

export function useInventory(locationCode?: string) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Initial Fetch
  const fetchInventory = async () => {
    setLoading(true);
    let query = supabase.from('inventory_items').select('*');
    
    if (locationCode) {
      query = query.eq('location_code', locationCode);
    }

    const { data, error } = await query;
    if (!error && data) setItems(data as InventoryItem[]);
    setLoading(false);
  };

  // 2. Real-time Subscription
  useEffect(() => {
    fetchInventory();

    // Listen for changes in the database (Scans, Orders, etc.)
    const subscription = supabase
      .channel('inventory-updates')
      .on('postgres_changes', { event: '*', table: 'inventory_items' }, () => {
        fetchInventory(); // Re-fetch when any change occurs
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [locationCode]);

  return { items, loading, refresh: fetchInventory };
}