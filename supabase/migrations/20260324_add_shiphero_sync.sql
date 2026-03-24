-- Add SKU column to inventory_items for cross-system mapping
ALTER TABLE inventory_items ADD COLUMN sku TEXT UNIQUE;

-- Function to atomically sync ShipHero receiving (increments total_quantity)
-- Used when physical stock arrives from warehouse/ShipHero
CREATE OR REPLACE FUNCTION sync_shiphero_receiving(
  sku_input TEXT,
  qty_received INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE inventory_items
  SET total_quantity = total_quantity + qty_received,
      last_synced_at = NOW(),
      updated_at = NOW()
  WHERE sku = sku_input;
  
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Function to atomically sync ShipHero shipment (decrements total_quantity)
-- Used when units ship out to customers
CREATE OR REPLACE FUNCTION sync_shiphero_shipment(
  sku_input TEXT,
  qty_shipped INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE inventory_items
  SET total_quantity = total_quantity - qty_shipped,
      last_synced_at = NOW(),
      updated_at = NOW()
  WHERE sku = sku_input;
  
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;
