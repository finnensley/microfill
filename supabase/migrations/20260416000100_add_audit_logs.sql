CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID,
  tenant_id UUID,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT,
  source TEXT NOT NULL DEFAULT 'database_trigger',
  changed_columns TEXT[],
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_inventory_item_id
  ON audit_logs(inventory_item_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created_at
  ON audit_logs(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION get_changed_inventory_columns(old_row JSONB, new_row JSONB)
RETURNS TEXT[] AS $$
  SELECT COALESCE(
    ARRAY_AGG(key ORDER BY key),
    ARRAY[]::TEXT[]
  )
  FROM (
    SELECT DISTINCT key
    FROM (
      SELECT jsonb_object_keys(old_row) AS key
      UNION
      SELECT jsonb_object_keys(new_row) AS key
    ) keys
    WHERE key NOT IN ('created_at', 'updated_at')
      AND old_row -> key IS DISTINCT FROM new_row -> key
  ) changed;
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION log_inventory_item_change()
RETURNS TRIGGER AS $$
DECLARE
  old_payload JSONB;
  new_payload JSONB;
  changed_keys TEXT[];
  actor_id UUID;
  actor_role_name TEXT;
  audit_source TEXT;
BEGIN
  old_payload := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  new_payload := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;

  changed_keys := CASE
    WHEN TG_OP = 'UPDATE' THEN get_changed_inventory_columns(old_payload, new_payload)
    ELSE ARRAY[]::TEXT[]
  END;

  IF TG_OP = 'UPDATE' AND COALESCE(array_length(changed_keys, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;

  actor_id := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
  actor_role_name := NULLIF(current_setting('request.jwt.claim.role', true), '');
  audit_source := COALESCE(NULLIF(current_setting('app.audit_source', true), ''), 'database_trigger');

  INSERT INTO audit_logs (
    inventory_item_id,
    tenant_id,
    action,
    actor_user_id,
    actor_role,
    source,
    changed_columns,
    old_values,
    new_values
  )
  VALUES (
    COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    TG_OP,
    actor_id,
    actor_role_name,
    audit_source,
    CASE WHEN TG_OP = 'UPDATE' THEN changed_keys ELSE NULL END,
    old_payload,
    new_payload
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_inventory_item_changes ON inventory_items;
CREATE TRIGGER audit_inventory_item_changes
AFTER INSERT OR UPDATE OR DELETE ON inventory_items
FOR EACH ROW
EXECUTE FUNCTION log_inventory_item_change();