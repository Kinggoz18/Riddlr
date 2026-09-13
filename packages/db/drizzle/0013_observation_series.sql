ALTER TABLE source_fetch_requests
  ALTER COLUMN scan_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS observation_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  metric text NOT NULL,
  subject_canonical_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  value double precision NOT NULL,
  unit text NOT NULL,
  fetch_request_id uuid REFERENCES source_fetch_requests(id),
  resolution text NOT NULL DEFAULT 'raw',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS observation_series_key_idx
  ON observation_series (provider, metric, subject_canonical_id, observed_at, resolution);
CREATE INDEX IF NOT EXISTS observation_series_subject_idx
  ON observation_series (subject_canonical_id, metric, observed_at DESC);

CREATE TABLE IF NOT EXISTS observation_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  metric text NOT NULL,
  subject_canonical_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS observation_pins_key_idx
  ON observation_pins (provider, metric, subject_canonical_id);
