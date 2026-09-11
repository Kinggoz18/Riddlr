ALTER TABLE agents ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE skills ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

UPDATE agents
SET description = 'The default Crypto watcher. It scans attached sources on a schedule, clusters evidence into events, and analyzes only material events. It cannot trade.'
WHERE kind = 'system_default' AND description = '';
