ALTER TABLE events
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS identity_key text,
  ADD COLUMN IF NOT EXISTS catalyst_kind text,
  ADD COLUMN IF NOT EXISTS subject_canonical_id text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_primary_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_evidence_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_event_id uuid REFERENCES events(id),
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at timestamptz;

UPDATE events
SET lifecycle_state = 'resolved'
WHERE status IN ('empty', 'deferred')
  AND lifecycle_state = 'open';

CREATE INDEX IF NOT EXISTS events_agent_identity_idx
  ON events (agent_id, identity_key, lifecycle_state)
  WHERE identity_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_notified_idx
  ON events (first_notified_at)
  WHERE first_notified_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_lifecycle_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  reason text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_lifecycle_transitions_event_idx
  ON event_lifecycle_transitions (event_id, at DESC);

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES signals(id) ON DELETE SET NULL,
  horizon text NOT NULL,
  metric text NOT NULL,
  baseline_value double precision NOT NULL,
  baseline_at timestamptz NOT NULL,
  observed_value double precision NOT NULL,
  observed_at timestamptz NOT NULL,
  delta_abs double precision NOT NULL,
  delta_pct double precision,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS signal_outcomes_event_horizon_metric_idx
  ON signal_outcomes (event_id, horizon, metric);
