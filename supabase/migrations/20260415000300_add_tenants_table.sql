CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_tenants_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_tenants_updated_at ON tenants;
CREATE TRIGGER set_tenants_updated_at
BEFORE UPDATE ON tenants
FOR EACH ROW
EXECUTE FUNCTION update_tenants_timestamp();

INSERT INTO tenants (id, name, slug)
SELECT DISTINCT
  tenant_id,
  'Tenant ' || LEFT(tenant_id::text, 8),
  LOWER(REPLACE(tenant_id::text, '-', ''))
FROM inventory_items
ON CONFLICT (id) DO NOTHING;

ALTER TABLE user_tenant_assignments
  DROP CONSTRAINT IF EXISTS user_tenant_assignments_tenant_id_fkey;

ALTER TABLE user_tenant_assignments
  ADD CONSTRAINT user_tenant_assignments_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;