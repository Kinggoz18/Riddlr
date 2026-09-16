ALTER TABLE scan_source_runs
  ADD COLUMN IF NOT EXISTS unresponsive_engines jsonb NOT NULL DEFAULT '[]'::jsonb;
