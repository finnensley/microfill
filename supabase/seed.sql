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
  ),
  ('00000000-0000-0000-0000-000000000103','10000000-0000-0000-0000-000000000001','shopify-product-103','shopify-variant-103','SKU-DEMO-GREEN',200,10,10,20,false,NOW()),
  ('00000000-0000-0000-0000-000000000104','10000000-0000-0000-0000-000000000001','shopify-product-104','shopify-variant-104','SKU-DEMO-BLACK',75,5,10,8,false,NOW()),
  ('00000000-0000-0000-0000-000000000105','10000000-0000-0000-0000-000000000001','shopify-product-105','shopify-variant-105','SKU-DEMO-WHITE',300,15,10,30,false,NOW()),
  ('00000000-0000-0000-0000-000000000106','10000000-0000-0000-0000-000000000001','shopify-product-106','shopify-variant-106','SKU-DEMO-NAVY',60,3,10,6,false,NOW()),
  ('00000000-0000-0000-0000-000000000107','10000000-0000-0000-0000-000000000001','shopify-product-107','shopify-variant-107','SKU-DEMO-GREY',90,6,10,9,false,NOW()),
  ('00000000-0000-0000-0000-000000000108','10000000-0000-0000-0000-000000000001','shopify-product-108','shopify-variant-108','SKU-DEMO-ORANGE',40,2,10,4,true,NOW()),
  ('00000000-0000-0000-0000-000000000109','10000000-0000-0000-0000-000000000001','shopify-product-109','shopify-variant-109','SKU-DEMO-PURPLE',150,8,10,15,false,NOW()),
  ('00000000-0000-0000-0000-000000000110','10000000-0000-0000-0000-000000000001','shopify-product-110','shopify-variant-110','SKU-DEMO-YELLOW',25,1,10,3,false,NOW()),
  ('00000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000001','shopify-product-111','shopify-variant-111','SKU-DEMO-PINK',110,7,10,11,false,NOW()),
  ('00000000-0000-0000-0000-000000000112','10000000-0000-0000-0000-000000000001','shopify-product-112','shopify-variant-112','SKU-DEMO-TEAL',80,4,10,8,false,NOW()),
  ('00000000-0000-0000-0000-000000000113','10000000-0000-0000-0000-000000000001','shopify-product-113','shopify-variant-113','SKU-DEMO-MAROON',55,3,15,9,false,NOW()),
  ('00000000-0000-0000-0000-000000000114','10000000-0000-0000-0000-000000000001','shopify-product-114','shopify-variant-114','SKU-DEMO-LIME',180,12,10,18,false,NOW()),
  ('00000000-0000-0000-0000-000000000115','10000000-0000-0000-0000-000000000001','shopify-product-115','shopify-variant-115','SKU-DEMO-CREAM',65,2,10,7,false,NOW()),
  ('00000000-0000-0000-0000-000000000116','10000000-0000-0000-0000-000000000001','shopify-product-116','shopify-variant-116','SKU-DEMO-CORAL',95,5,10,10,false,NOW()),
  ('00000000-0000-0000-0000-000000000117','10000000-0000-0000-0000-000000000001','shopify-product-117','shopify-variant-117','SKU-DEMO-INDIGO',130,9,10,13,false,NOW()),
  ('00000000-0000-0000-0000-000000000118','10000000-0000-0000-0000-000000000001','shopify-product-118','shopify-variant-118','SKU-DEMO-SILVER',45,2,10,5,false,NOW()),
  ('00000000-0000-0000-0000-000000000119','10000000-0000-0000-0000-000000000001','shopify-product-119','shopify-variant-119','SKU-DEMO-GOLD',30,1,10,3,false,NOW()),
  ('00000000-0000-0000-0000-000000000120','10000000-0000-0000-0000-000000000001','shopify-product-120','shopify-variant-120','SKU-DEMO-BRONZE',70,4,10,7,false,NOW()),
  ('00000000-0000-0000-0000-000000000121','10000000-0000-0000-0000-000000000001','shopify-product-121','shopify-variant-121','SKU-DEMO-CHARCOAL',160,11,10,16,false,NOW()),
  ('00000000-0000-0000-0000-000000000122','10000000-0000-0000-0000-000000000001','shopify-product-122','shopify-variant-122','SKU-DEMO-OLIVE',85,5,10,9,false,NOW()),
  ('00000000-0000-0000-0000-000000000123','10000000-0000-0000-0000-000000000001','shopify-product-123','shopify-variant-123','SKU-DEMO-ROSE',50,3,10,5,false,NOW()),
  ('00000000-0000-0000-0000-000000000124','10000000-0000-0000-0000-000000000001','shopify-product-124','shopify-variant-124','SKU-DEMO-CRIMSON',100,6,10,10,false,NOW()),
  ('00000000-0000-0000-0000-000000000125','10000000-0000-0000-0000-000000000001','shopify-product-125','shopify-variant-125','SKU-DEMO-VIOLET',140,8,10,14,false,NOW()),
  ('00000000-0000-0000-0000-000000000126','10000000-0000-0000-0000-000000000001','shopify-product-126','shopify-variant-126','SKU-DEMO-AMBER',38,2,10,4,false,NOW()),
  ('00000000-0000-0000-0000-000000000127','10000000-0000-0000-0000-000000000001','shopify-product-127','shopify-variant-127','SKU-DEMO-JADE',115,7,10,12,false,NOW()),
  ('00000000-0000-0000-0000-000000000128','10000000-0000-0000-0000-000000000001','shopify-product-128','shopify-variant-128','SKU-DEMO-COBALT',72,4,10,8,false,NOW()),
  ('00000000-0000-0000-0000-000000000129','10000000-0000-0000-0000-000000000001','shopify-product-129','shopify-variant-129','SKU-DEMO-PEARL',190,13,10,19,false,NOW()),
  ('00000000-0000-0000-0000-000000000130','10000000-0000-0000-0000-000000000001','shopify-product-130','shopify-variant-130','SKU-DEMO-SLATE',62,3,10,7,false,NOW())
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