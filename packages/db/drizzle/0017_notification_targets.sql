CREATE TABLE IF NOT EXISTS notification_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  name text,
  destination text NOT NULL,
  guild_id text,
  username text,
  avatar_url text,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ok',
  secret_id uuid REFERENCES encrypted_secrets(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_notification_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  min_impact text NOT NULL,
  catalyst_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,
  asset_canonical_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  reliability_statuses jsonb NOT NULL DEFAULT '[]'::jsonb,
  include_early_warnings boolean NOT NULL DEFAULT false,
  target_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_notification_routes_agent_idx
  ON agent_notification_routes (agent_id);

CREATE TABLE IF NOT EXISTS observation_alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric text NOT NULL,
  op text NOT NULL,
  threshold double precision NOT NULL,
  window_minutes integer,
  subject_canonical_id text,
  provider text,
  target_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_deliveries
  ALTER COLUMN signal_id DROP NOT NULL;

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'signal',
  ADD COLUMN IF NOT EXISTS target_id text,
  ADD COLUMN IF NOT EXISTS observation_rule_id uuid REFERENCES observation_alert_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS observation_metric text,
  ADD COLUMN IF NOT EXISTS observation_value double precision,
  ADD COLUMN IF NOT EXISTS observation_threshold double precision,
  ADD COLUMN IF NOT EXISTS observation_provider text,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;

CREATE INDEX IF NOT EXISTS notification_deliveries_target_pending_idx
  ON notification_deliveries (target_id, status);
