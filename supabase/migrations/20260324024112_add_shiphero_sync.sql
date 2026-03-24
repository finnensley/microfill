-- Add SKU column to inventory_items for cross-system mapping
ALTER TABLE inventory_items ADD COLUMN sku TEXT UNIQUE;

-- Create index on (tenant_id, sku) for fast multi-tenant lookups
-- Note: tenant_id should exist from the multi-tenancy migration
CREATE INDEX IF NOT EXISTS idx_inventory_tenant_sku 
  ON inventory_items(tenant_id, sku);

-- Note: sync_shiphero_receiving() and sync_shiphero_shipment() functions
-- are created in the multi-tenancy migration with tenant_id support
