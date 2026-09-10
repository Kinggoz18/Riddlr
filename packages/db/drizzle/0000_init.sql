CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  username text,
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  two_factor_satisfied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (token_hash);

CREATE TABLE IF NOT EXISTS auth_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  secret_ciphertext text NOT NULL,
  secret_nonce text NOT NULL,
  secret_tag text NOT NULL,
  verified_at timestamptz
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  code_hash text NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS instance_settings (
  id integer PRIMARY KEY DEFAULT 1,
  setup_step text NOT NULL DEFAULT 'admin',
  onboarding_completed_at timestamptz,
  key_version integer NOT NULL DEFAULT 1
);
INSERT INTO instance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS market_domains (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  coming_soon boolean NOT NULL,
  documentation_reference text NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_classes (
  id text PRIMARY KEY,
  market_domain_id text NOT NULL REFERENCES market_domains(id),
  name text NOT NULL
);

INSERT INTO market_domains (id, name, description, status, coming_soon, documentation_reference) VALUES
  ('crypto', 'Crypto', 'Cryptocurrencies, meme coins, stablecoins, crypto narratives, and crypto market events.', 'supported', false, '/docs/market-domains.md'),
  ('equities', 'Equities', 'Stocks and ETFs. Planned domain — not executable.', 'coming_soon', true, '/docs/market-domains.md'),
  ('forex', 'Forex', 'Fiat currencies and FX pairs. Planned domain — not executable.', 'coming_soon', true, '/docs/market-domains.md'),
  ('commodities', 'Commodities', 'Commodity markets. Planned domain — not executable.', 'coming_soon', true, '/docs/market-domains.md'),
  ('macro', 'Macro', 'Inflation, rates, employment, and policy context. Planned domain — not executable.', 'coming_soon', true, '/docs/market-domains.md')
ON CONFLICT (id) DO NOTHING;

INSERT INTO asset_classes (id, market_domain_id, name) VALUES
  ('cryptocurrency', 'crypto', 'Cryptocurrency'),
  ('meme_coin', 'crypto', 'Meme coin'),
  ('stablecoin', 'crypto', 'Stablecoin'),
  ('fiat_currency', 'forex', 'Fiat currency'),
  ('forex_pair', 'forex', 'Forex pair'),
  ('stock', 'equities', 'Stock'),
  ('etf', 'equities', 'ETF'),
  ('commodity', 'commodities', 'Commodity'),
  ('index', 'equities', 'Index')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS encrypted_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL,
  ciphertext text NOT NULL,
  nonce text NOT NULL,
  tag text NOT NULL,
  alg text NOT NULL,
  key_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_id uuid REFERENCES encrypted_secrets(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule text NOT NULL DEFAULT '1h',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_market_domains (
  agent_id uuid NOT NULL REFERENCES agents(id),
  market_domain_id text NOT NULL REFERENCES market_domains(id),
  PRIMARY KEY (agent_id, market_domain_id)
);

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  version text NOT NULL,
  origin text NOT NULL,
  markdown_body text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS skills_slug_idx ON skills (slug);

CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id uuid NOT NULL REFERENCES agents(id),
  skill_id uuid NOT NULL REFERENCES skills(id),
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_class text NOT NULL,
  canonical_id text NOT NULL,
  symbol text,
  name text
);
CREATE UNIQUE INDEX IF NOT EXISTS assets_class_canonical_idx ON assets (asset_class, canonical_id);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family text NOT NULL,
  adapter_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_health_ok boolean,
  last_health_message text,
  last_health_at timestamptz
);

CREATE TABLE IF NOT EXISTS scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  status text NOT NULL,
  partial boolean NOT NULL DEFAULT false,
  window_start timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS scans_idempotency_idx ON scans (idempotency_key);

CREATE TABLE IF NOT EXISTS scan_source_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES scans(id),
  source_id uuid NOT NULL REFERENCES sources(id),
  status text NOT NULL,
  error_class text,
  error_message text,
  evidence_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id),
  scan_id uuid NOT NULL REFERENCES scans(id),
  fingerprint text NOT NULL,
  content_hash text NOT NULL,
  canonical_url text,
  title text,
  body_text text,
  author text,
  published_at timestamptz,
  fetched_at timestamptz NOT NULL,
  adapter_payload jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_fingerprint_idx ON evidence_items (fingerprint);

CREATE TABLE IF NOT EXISTS evidence_relations (
  from_id uuid NOT NULL REFERENCES evidence_items(id),
  to_id uuid NOT NULL REFERENCES evidence_items(id),
  kind text NOT NULL,
  PRIMARY KEY (from_id, to_id, kind)
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  scan_id uuid NOT NULL REFERENCES scans(id),
  title text NOT NULL,
  status text NOT NULL,
  window_start timestamptz NOT NULL,
  independent_count integer NOT NULL DEFAULT 0,
  derived_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS event_evidence (
  event_id uuid NOT NULL REFERENCES events(id),
  evidence_id uuid NOT NULL REFERENCES evidence_items(id),
  role text NOT NULL,
  PRIMARY KEY (event_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  model text NOT NULL,
  schema_version text NOT NULL,
  prompt_tokens integer,
  completion_tokens integer,
  latency_ms integer,
  raw_output jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  agent_id uuid NOT NULL REFERENCES agents(id),
  headline text NOT NULL,
  why_it_matters text NOT NULL,
  proof jsonb NOT NULL,
  action text NOT NULL,
  risk text NOT NULL,
  confidence text NOT NULL,
  market_context text,
  contradictory_evidence text,
  invalidation_conditions text,
  schema_version text NOT NULL DEFAULT '1',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS signals_event_agent_schema_idx ON signals (event_id, agent_id, schema_version);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer,
  completion_tokens integer,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES signals(id),
  channel text NOT NULL,
  status text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_idempotency_idx ON notification_deliveries (idempotency_key);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL,
  resource text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
