export interface InventoryItem {
  id: string;
  product_id: string;
  location_code: string;
  physical_quantity: number;   // On-Hand
  committed_quantity: number;  // Reserved for orders
  available_to_sell: number;   // Calculated: Physical - Committed
  last_sync: string;
}

export interface AuditLog {
  id: string;
  inventory_id: string;
  action_type: 'ORDER_COMMITTED' | 'PHYSICAL_SHIPMENT' | 'MANUAL_ADJUST';
  user_id: string;
  created_at: string;
}