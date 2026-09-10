SELECT pg_advisory_xact_lock(850017);

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS last_message_id text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

CREATE TABLE IF NOT EXISTS whatsapp_webhook_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL,
  from_e164 text NOT NULL,
  inbound_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_webhook_messages_id_idx
  ON whatsapp_webhook_messages (message_id);

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS destination text,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS error_class text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS agent_sources (
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, source_id)
);

ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS retry_attempt integer NOT NULL DEFAULT 0;

ALTER TABLE evidence_items
  ADD COLUMN IF NOT EXISTS source_family text,
  ADD COLUMN IF NOT EXISTS adapter_id text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS fetch_request_id uuid;

CREATE TABLE IF NOT EXISTS source_fetch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES scans(id),
  source_id uuid NOT NULL REFERENCES sources(id),
  adapter_id text NOT NULL,
  request_hash text NOT NULL,
  request_url text,
  provider_request_id text,
  pagination_cursor text,
  status text NOT NULL,
  error_class text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  evidence_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS source_fetch_requests_scan_idx ON source_fetch_requests (scan_id);

CREATE TABLE IF NOT EXISTS evidence_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES evidence_items(id),
  scan_id uuid NOT NULL REFERENCES scans(id),
  source_id uuid NOT NULL REFERENCES sources(id),
  fetch_request_id uuid REFERENCES source_fetch_requests(id),
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_occurrences_scan_evidence_idx
  ON evidence_occurrences (scan_id, evidence_id);

CREATE TABLE IF NOT EXISTS entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  canonical_id text NOT NULL,
  display_name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS entities_kind_canonical_idx ON entities (kind, canonical_id);

CREATE TABLE IF NOT EXISTS entity_aliases (
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias text NOT NULL,
  PRIMARY KEY (entity_id, alias)
);

CREATE TABLE IF NOT EXISTS instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  venue text,
  pair text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS event_entities (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, entity_id)
);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cluster_fingerprint text,
  ADD COLUMN IF NOT EXISTS materiality_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS events_scan_fingerprint_idx
  ON events (scan_id, cluster_fingerprint)
  WHERE cluster_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS analysis_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  schema_version text NOT NULL,
  prompt_hash text NOT NULL,
  skill_hash text NOT NULL,
  context_hash text NOT NULL,
  raw_output jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS analysis_cache_identity_idx
  ON analysis_cache (provider, model, schema_version, prompt_hash, skill_hash, context_hash);

ALTER TABLE ai_usage_events
  ADD COLUMN IF NOT EXISTS completion_total integer,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd text,
  ADD COLUMN IF NOT EXISTS cache_hit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS reservation_tokens integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'recorded';

CREATE TABLE IF NOT EXISTS token_budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  day_utc date NOT NULL,
  reserved_tokens integer NOT NULL,
  consumed_tokens integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS token_budget_reservations_agent_day_idx
  ON token_budget_reservations (agent_id, day_utc);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  holdings jsonb NOT NULL,
  note text
);
CREATE INDEX IF NOT EXISTS portfolio_snapshots_portfolio_idx
  ON portfolio_snapshots (portfolio_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS llm_price_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  prompt_usd_per_million text NOT NULL,
  completion_usd_per_million text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS llm_price_table_model_idx ON llm_price_table (provider, model);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS custom_interval_ms integer,
  ADD COLUMN IF NOT EXISTS notification_policy jsonb NOT NULL DEFAULT '{"minRisk":"moderate","cooldownMinutes":30}'::jsonb;

CREATE TABLE IF NOT EXISTS agent_portfolios (
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, portfolio_id)
);

CREATE INDEX IF NOT EXISTS evidence_items_source_fetched_idx ON evidence_items (source_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS signals_event_created_idx ON signals (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_agent_window_idx ON events (agent_id, window_start DESC);
CREATE INDEX IF NOT EXISTS scans_agent_started_idx ON scans (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS notification_deliveries_status_updated_idx
  ON notification_deliveries (status, updated_at);
CREATE INDEX IF NOT EXISTS evidence_occurrences_evidence_idx ON evidence_occurrences (evidence_id);
