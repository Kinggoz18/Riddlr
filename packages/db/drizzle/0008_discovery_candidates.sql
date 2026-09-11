ALTER TABLE events ADD COLUMN IF NOT EXISTS epistemic_status text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS candidate_kind text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS discovery_reason text;

ALTER TABLE signals ADD COLUMN IF NOT EXISTS epistemic_status text NOT NULL DEFAULT 'signal';

UPDATE agents
SET description = 'The default Crypto watcher. It scans attached sources on a schedule, discovers candidates from evidence, and analyzes material clusters. A candidate is not a trade. It cannot trade.'
WHERE kind = 'system_default'
  AND description = 'The default Crypto watcher. It scans attached sources on a schedule, clusters evidence into events, and analyzes only material events. It cannot trade.';
