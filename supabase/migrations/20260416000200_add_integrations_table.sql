CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('shopify', 'shiphero', 'fishbowl', 'netsuite')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'error')),
  display_name TEXT,
  external_account_id TEXT,
  external_shop_domain TEXT,
  webhook_secret TEXT,
  api_key TEXT,
  api_secret TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_tenant_provider
  ON integrations(tenant_id, provider);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_provider_external_account
  ON integrations(provider, external_account_id)
  WHERE external_account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_provider_shop_domain
  ON integrations(provider, lower(external_shop_domain))
  WHERE external_shop_domain IS NOT NULL;

CREATE OR REPLACE FUNCTION update_integrations_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_integrations_updated_at ON integrations;
CREATE TRIGGER set_integrations_updated_at
BEFORE UPDATE ON integrations
FOR EACH ROW
EXECUTE FUNCTION update_integrations_timestamp();

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
