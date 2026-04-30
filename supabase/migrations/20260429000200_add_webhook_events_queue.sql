-- Webhook event queue for async WMS processing.
-- Routes enqueue verified payloads and return 2xx immediately.
-- A worker processes events from this table so timeouts and retries
-- do not affect the webhook delivery acknowledgement.

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  event_type TEXT,
  external_id TEXT,
  provider_message_id TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Efficient poll query: find pending events with elapsed next_attempt_at
CREATE INDEX IF NOT EXISTS idx_webhook_events_queue_poll
  ON webhook_events(next_attempt_at ASC)
  WHERE status = 'pending';

-- Tenant-scoped event history for dashboard operator views
CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant_created
  ON webhook_events(tenant_id, created_at DESC);

-- Idempotency guard: prevent duplicate ingestion when providers retry
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_provider_message_id
  ON webhook_events(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Automatic updated_at timestamp
CREATE OR REPLACE FUNCTION update_webhook_events_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_webhook_events_updated_at ON webhook_events;
CREATE TRIGGER set_webhook_events_updated_at
BEFORE UPDATE ON webhook_events
FOR EACH ROW
EXECUTE FUNCTION update_webhook_events_timestamp();

-- Atomic batch claim using SELECT FOR UPDATE SKIP LOCKED.
-- Moves claimed rows to 'processing' and increments attempt count.
-- Only workers running with service role should call this.
CREATE OR REPLACE FUNCTION claim_webhook_events(batch_size INTEGER)
RETURNS SETOF webhook_events AS $$
BEGIN
  RETURN QUERY
  UPDATE webhook_events
  SET
    status = 'processing',
    attempts = attempts + 1,
    updated_at = NOW()
  WHERE id IN (
    SELECT id FROM webhook_events
    WHERE status = 'pending'
      AND next_attempt_at <= NOW()
    ORDER BY created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Service role (used by workers and webhook routes) bypasses RLS
CREATE POLICY webhook_events_service_only
  ON webhook_events
  AS PERMISSIVE
  FOR ALL
  USING (true);
