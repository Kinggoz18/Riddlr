ALTER TABLE scan_source_runs
  ADD COLUMN IF NOT EXISTS rejected_irrelevant_count integer NOT NULL DEFAULT 0;
