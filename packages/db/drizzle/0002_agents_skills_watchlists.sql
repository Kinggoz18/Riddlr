ALTER TABLE agents ADD COLUMN IF NOT EXISTS token_budget integer NOT NULL DEFAULT 8000;

CREATE TABLE IF NOT EXISTS watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS watchlists_agent_idx ON watchlists (agent_id);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  asset_class text NOT NULL,
  canonical_id text NOT NULL,
  symbol text,
  name text
);
CREATE UNIQUE INDEX IF NOT EXISTS watchlist_items_canonical_idx ON watchlist_items (watchlist_id, canonical_id);

ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents(id);
CREATE INDEX IF NOT EXISTS ai_usage_agent_created_idx ON ai_usage_events (agent_id, created_at DESC);
