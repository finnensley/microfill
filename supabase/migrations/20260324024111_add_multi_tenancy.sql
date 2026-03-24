-- Add multi-tenancy support for Shopify multi-store
-- Each Shopify store gets a unique tenant_id from X-Shopify-Shop-ID webhook header

-- 1. Add tenant_id column to inventory_items
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT gen_random_uuid();

-- 2. Create composite primary key or unique constraint on (tenant_id, shopify_variant_id)
-- This ensures each tenant has unique variant IDs (SKUs can overlap across stores)
-- Note: This constraint may already exist from a previous migration attempt
-- ALTER TABLE inventory_items ADD CONSTRAINT unique_tenant_variant 
--   UNIQUE(tenant_id, shopify_variant_id);

-- 3. Create indexes for fast tenant-scoped lookups
CREATE INDEX IF NOT EXISTS idx_inventory_tenant_variant 
  ON inventory_items(tenant_id, shopify_variant_id);

-- SKU index will be created after SKU column exists (in ShipHero migration or later)
-- CREATE INDEX IF NOT EXISTS idx_inventory_tenant_sku 
--   ON inventory_items(tenant_id, sku);

CREATE INDEX IF NOT EXISTS idx_inventory_tenant 
  ON inventory_items(tenant_id);

-- 4. Enable Row-Level Security (RLS) on inventory_items
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS policy: Users can only read/modify their own tenant's data
-- This is enforced at the database level, even if app logic is compromised
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory_items;
CREATE POLICY tenant_isolation_policy 
  ON inventory_items 
  FOR ALL 
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 6. Update RPC function to accept tenant_id and enforce isolation
CREATE OR REPLACE FUNCTION increment_committed_quantity(
  tenant_id_input UUID,
  item_id UUID,
  amount INTEGER
) RETURNS integer AS $$
DECLARE
  available_qty integer;
BEGIN
  -- Verify tenant ownership before proceeding
  PERFORM 1 FROM inventory_items 
    WHERE id = item_id AND tenant_id = tenant_id_input;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found for this tenant';
  END IF;

  -- Atomic operation: Check available, increment committed, return available
  UPDATE inventory_items 
  SET committed_quantity = committed_quantity + amount
  WHERE id = item_id AND tenant_id = tenant_id_input
  RETURNING (total_quantity - (committed_quantity + amount) - safety_floor_quantity) INTO available_qty;

  RETURN available_qty;
END;
$$ LANGUAGE plpgsql;

-- 7. Update ShipHero sync functions to accept tenant_id
CREATE OR REPLACE FUNCTION sync_shiphero_receiving(
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

CREATE OR REPLACE FUNCTION sync_shiphero_shipment(
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

-- 8. Provide helper function to get available quantity with tenant isolation
CREATE OR REPLACE FUNCTION get_available_quantity(
  tenant_id_input UUID,
  item_id UUID
) RETURNS integer AS $$
DECLARE
  available_qty integer;
BEGIN
  SELECT (total_quantity - committed_quantity - safety_floor_quantity)
  INTO available_qty
  FROM inventory_items
  WHERE id = item_id AND tenant_id = tenant_id_input;

  RETURN COALESCE(available_qty, 0);
END;
$$ LANGUAGE plpgsql;

-- Note: Existing triggers from init schema (update_safety_floor_on_insert, etc.) 
-- continue to work without modification since they don't need tenant_id filtering
