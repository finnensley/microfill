-- Rename ShipHero-specific sync function names to generic WMS equivalents.
-- The underlying logic was already provider-agnostic: it updates total_quantity
-- by SKU + tenant and contains no ShipHero-specific behavior. Renaming allows
-- any WMS adapter that emits stock_received / stock_shipped events to share
-- these functions without implying a ShipHero-only dependency.

CREATE OR REPLACE FUNCTION sync_wms_stock_received(
  tenant_id_input UUID,
  sku_input TEXT,
  qty_received INTEGER
) RETURNS void AS $$
BEGIN
  UPDATE inventory_items
  SET total_quantity = total_quantity + qty_received
  WHERE sku = sku_input AND tenant_id = tenant_id_input;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_wms_stock_shipped(
  tenant_id_input UUID,
  sku_input TEXT,
  qty_shipped INTEGER
) RETURNS void AS $$
BEGIN
  UPDATE inventory_items
  SET total_quantity = total_quantity - qty_shipped
  WHERE sku = sku_input AND tenant_id = tenant_id_input;
END;
$$ LANGUAGE plpgsql;

-- Drop the ShipHero-specific names now that the generic functions exist.
DROP FUNCTION IF EXISTS sync_shiphero_receiving(UUID, TEXT, INTEGER);
DROP FUNCTION IF EXISTS sync_shiphero_shipment(UUID, TEXT, INTEGER);
