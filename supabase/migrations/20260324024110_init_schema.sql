-- MicroFill Inventory Schema
-- 
-- NOTE: Physical location tracking (e.g., bin/shelf codes) is intentionally omitted.
-- MicroFill assumes the client's WMS (Warehouse Management System) is the source of truth
-- for physical locations. This schema focuses on Shopify inventory sync and atomic buffering
-- to prevent oversells during high-concurrency events.
--
-- Three-Layer Protection:
-- 1. Atomic Increments: committed_quantity uses SQL-level atomic updates (not Read-Modify-Write)
--    PROBLEM: Traditional middleware reads the value, decrements it, writes it back.
--    If 2 orders come at the exact millisecond:
--      - Both read 10 → Both subtract 1 → Both write 9 (data loss!)
--    SOLUTION: UPDATE committed_quantity = committed_quantity + amount
--    This happens INSIDE the DB engine, preventing race conditions at any concurrency level.
--
-- 2. Safety Buffering: safety_floor_quantity hides the last 5-10% of stock from Shopify
--    This absorbs API latency during peak surges without overselling.
--
-- 3. Flash Mode: manual toggle to pause outgoing API syncs during extreme peaks
--    Then one-click reconciliation afterward.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Inventory Items Table
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id TEXT NOT NULL UNIQUE,
  shopify_variant_id TEXT NOT NULL,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  committed_quantity INTEGER NOT NULL DEFAULT 0,
  safety_floor_percent DECIMAL(5, 2) NOT NULL DEFAULT 10,
  safety_floor_quantity INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  flash_mode_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX idx_inventory_shopify_product_id ON inventory_items(shopify_product_id);
CREATE INDEX idx_inventory_updated_at ON inventory_items(updated_at);

-- Function to calculate available quantity (accounting for atomic buffering + safety floor)
CREATE OR REPLACE FUNCTION get_available_quantity(item_id UUID)
RETURNS INTEGER AS $$
  SELECT (total_quantity - committed_quantity - safety_floor_quantity)
  FROM inventory_items
  WHERE id = item_id;
$$ LANGUAGE SQL;

-- Function to atomically increment committed quantity (prevents race conditions)
CREATE OR REPLACE FUNCTION increment_committed_quantity(
  item_id UUID,
  amount INTEGER
)
RETURNS INTEGER AS $$
DECLARE
  available INTEGER;
BEGIN
  UPDATE inventory_items
  SET committed_quantity = committed_quantity + amount,
      updated_at = NOW()
  WHERE id = item_id;
  
  available := get_available_quantity(item_id);
  RETURN available;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update safety floor when total quantity changes
CREATE OR REPLACE FUNCTION update_safety_floor()
RETURNS TRIGGER AS $$
BEGIN
  NEW.safety_floor_quantity := ROUND((NEW.total_quantity * NEW.safety_floor_percent) / 100.0)::INTEGER;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_inventory_threshold
BEFORE UPDATE ON inventory_items
FOR EACH ROW
EXECUTE FUNCTION update_safety_floor();

-- Trigger to update timestamp
CREATE OR REPLACE FUNCTION update_inventory_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_inventory_updated_at
BEFORE UPDATE ON inventory_items
FOR EACH ROW
EXECUTE FUNCTION update_inventory_timestamp();

-- Enable Row Level Security (optional but recommended for multi-tenant apps)
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;