-- Add shopify_inventory_item_id to inventory_items.
--
-- Shopify's inventory_item_id (a separate numeric ID distinct from product/variant IDs)
-- is required to call the Admin REST API inventory_levels endpoints.
-- We look it up from Shopify once and cache it here so subsequent syncs
-- do not require an extra API round-trip.
--
-- Nullable — NULL means the ID has not been fetched yet.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS shopify_inventory_item_id TEXT;
