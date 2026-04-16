INSERT INTO tenants (id, name, slug)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'MicroFill Demo Tenant',
  'microfill-demo-tenant'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_items (
  id,
  tenant_id,
  shopify_product_id,
  shopify_variant_id,
  sku,
  total_quantity,
  committed_quantity,
  safety_floor_percent,
  safety_floor_quantity,
  flash_mode_enabled,
  last_synced_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    '10000000-0000-0000-0000-000000000001',
    'shopify-product-101',
    'shopify-variant-101',
    'SKU-DEMO-RED',
    120,
    4,
    10,
    12,
    false,
    NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    '10000000-0000-0000-0000-000000000001',
    'shopify-product-102',
    'shopify-variant-102',
    'SKU-DEMO-BLUE',
    48,
    2,
    10,
    5,
    false,
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO integrations (
  id,
  tenant_id,
  provider,
  status,
  display_name,
  external_account_id,
  external_shop_domain,
  webhook_secret,
  config
)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'shopify',
  'active',
  'Local Shopify Replay',
  'demo-shop',
  'demo-shop.myshopify.com',
  'replace-for-local-testing',
  '{}'::jsonb
)
ON CONFLICT (tenant_id, provider) DO UPDATE
SET
  status = EXCLUDED.status,
  display_name = EXCLUDED.display_name,
  external_account_id = EXCLUDED.external_account_id,
  external_shop_domain = EXCLUDED.external_shop_domain,
  webhook_secret = EXCLUDED.webhook_secret,
  config = EXCLUDED.config;

INSERT INTO integrations (
  id,
  tenant_id,
  provider,
  status,
  display_name,
  external_account_id,
  webhook_secret,
  config
)
VALUES (
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'shiphero',
  'active',
  'Local ShipHero Replay',
  'demo-shiphero-account',
  'replace-for-local-testing',
  '{}'::jsonb
)
ON CONFLICT (tenant_id, provider) DO UPDATE
SET
  status = EXCLUDED.status,
  display_name = EXCLUDED.display_name,
  external_account_id = EXCLUDED.external_account_id,
  webhook_secret = EXCLUDED.webhook_secret,
  config = EXCLUDED.config;