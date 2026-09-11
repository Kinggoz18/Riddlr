ALTER TABLE analyses ADD COLUMN IF NOT EXISTS skill_trace jsonb;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS notify_eligible boolean NOT NULL DEFAULT true;
