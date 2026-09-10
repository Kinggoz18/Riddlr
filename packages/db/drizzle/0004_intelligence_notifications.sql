ALTER TABLE instance_settings
  ADD COLUMN IF NOT EXISTS notification_policy jsonb NOT NULL DEFAULT '{"minRisk":"moderate","cooldownMinutes":30}'::jsonb;

CREATE TABLE IF NOT EXISTS event_assets (
  event_id uuid NOT NULL REFERENCES events(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  PRIMARY KEY (event_id, asset_id)
);

CREATE TABLE IF NOT EXISTS observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  kind text NOT NULL,
  asset_canonical_id text,
  value jsonb NOT NULL,
  unit text,
  observed_at timestamptz NOT NULL,
  source_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portfolio_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  chain text NOT NULL,
  address text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_wallets_addr_idx
  ON portfolio_wallets (portfolio_id, chain, address);

CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  asset_class text NOT NULL,
  canonical_id text NOT NULL,
  quantity text,
  symbol text,
  name text
);
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_holdings_canonical_idx
  ON portfolio_holdings (portfolio_id, canonical_id);

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_e164 text NOT NULL,
  last_inbound_at timestamptz NOT NULL,
  window_until timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_sessions_to_idx ON whatsapp_sessions (to_e164);

CREATE INDEX IF NOT EXISTS evidence_items_fetched_idx ON evidence_items (fetched_at DESC);
CREATE INDEX IF NOT EXISTS events_window_start_idx ON events (window_start DESC);
CREATE INDEX IF NOT EXISTS signals_created_at_idx ON signals (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS observations_observed_at_idx ON observations (observed_at DESC);
CREATE INDEX IF NOT EXISTS scans_started_at_idx ON scans (started_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_created_at_idx ON ai_usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS notification_created_at_idx ON notification_deliveries (created_at DESC);
