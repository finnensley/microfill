CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_insert_leads ON leads;
CREATE POLICY public_insert_leads
  ON leads
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_read_leads ON leads;
CREATE POLICY authenticated_read_leads
  ON leads
  FOR SELECT
  TO authenticated
  USING (true);