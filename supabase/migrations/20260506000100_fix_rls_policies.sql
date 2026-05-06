-- Fix and complete RLS policies across all tables.
--
-- Design principles:
--   - Service role (used by all API routes) bypasses RLS automatically in Supabase.
--     No explicit service-role policies are needed.
--   - Authenticated browser clients are scoped to the tenant(s) assigned to the
--     logged-in user via user_tenant_assignments.
--   - Anon clients should never reach tenant-scoped data.

-- ---------------------------------------------------------------------------
-- 1. inventory_items
--    Replace the fragile current_setting('app.current_tenant_id') policy with
--    an auth.uid() join. The GUC approach required the app to explicitly SET the
--    variable each connection; the join approach works automatically for any
--    authenticated browser client.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory_items;

CREATE POLICY inventory_items_tenant_isolation
  ON inventory_items
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenant_assignments WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM user_tenant_assignments WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. integrations
--    RLS was enabled but no policies existed → everything was denied for
--    non-service-role callers. Add tenant isolation.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS integrations_tenant_isolation ON integrations;

CREATE POLICY integrations_tenant_isolation
  ON integrations
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenant_assignments WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM user_tenant_assignments WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. audit_logs
--    RLS was not enabled — any caller could read all tenants' audit history.
--    Enable RLS and restrict reads to the caller's own tenant(s).
--    Writes are service-role only (via queue worker / webhook pipeline).
-- ---------------------------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit_logs;

CREATE POLICY audit_logs_tenant_isolation
  ON audit_logs
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenant_assignments WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. tenants
--    RLS was not enabled — any caller could list all tenants.
--    Enable RLS and allow authenticated users to read only their own tenant(s).
--    Writes (INSERT/UPDATE) are service-role only.
-- ---------------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_tenant_isolation ON tenants;

CREATE POLICY tenants_tenant_isolation
  ON tenants
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT tenant_id FROM user_tenant_assignments WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5. webhook_events
--    The existing policy used USING (true) with no role restriction, allowing
--    any anon or authenticated caller to read all events across all tenants.
--    Drop it — service role bypasses RLS automatically, and no other role
--    should ever access this table directly.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS webhook_events_service_only ON webhook_events;
