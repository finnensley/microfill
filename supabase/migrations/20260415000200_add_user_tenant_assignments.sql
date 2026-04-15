CREATE TABLE IF NOT EXISTS user_tenant_assignments (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_tenant_assignments_tenant_id
  ON user_tenant_assignments(tenant_id);

CREATE OR REPLACE FUNCTION update_user_tenant_assignments_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_user_tenant_assignments_updated_at ON user_tenant_assignments;
CREATE TRIGGER set_user_tenant_assignments_updated_at
BEFORE UPDATE ON user_tenant_assignments
FOR EACH ROW
EXECUTE FUNCTION update_user_tenant_assignments_timestamp();

ALTER TABLE user_tenant_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_reads_own_tenant_assignment ON user_tenant_assignments;
CREATE POLICY user_reads_own_tenant_assignment
  ON user_tenant_assignments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);