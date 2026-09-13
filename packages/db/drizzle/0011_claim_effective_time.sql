ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS effective_start timestamptz,
  ADD COLUMN IF NOT EXISTS effective_end timestamptz;

UPDATE signals
SET notify_eligible = false
WHERE notify_eligible = true
  AND event_id IN (
    SELECT id FROM events WHERE reliability_status = 'legacy_unassessed'
  );
