export interface ShipHeroPOUpdate {
  webhook_type: 'PO Update';
  po_id: number;
  po_number: string;
  status: 'pending' | 'partially_received' | 'received' | 'closed';
  warehouse_id: number;
  line_items: ShipHeroPOLineItem[];
}

export interface ShipHeroPOLineItem {
  sku: string;
  quantity: number;          // Total ordered on PO
  quantity_received: number; // New units scanned in this session
  sellable_quantity: number; // Total now available in ShipHero
  product_name: string;
  barcode: string;
}

export interface ShipHeroShipmentUpdate {
  webhook_type: 'Shipment Update';
  order_id: number;
  order_number: string;
  tracking_number: string;
  line_items: {
    sku: string;
    quantity: number; // Number of units packed and shipped
  }[];
}