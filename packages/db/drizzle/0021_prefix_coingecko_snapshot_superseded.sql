INSERT INTO event_lifecycle_transitions (event_id, from_state, to_state, reason)
SELECT id, lifecycle_state, 'superseded', 'pre_fix_market_snapshot'
FROM events
WHERE title = 'Search mention · www.coingecko.com'
  AND reliability_status = 'mention'
  AND lifecycle_state IS DISTINCT FROM 'superseded';

UPDATE events
SET
  lifecycle_state = 'superseded',
  lifecycle_changed_at = now()
WHERE title = 'Search mention · www.coingecko.com'
  AND reliability_status = 'mention'
  AND lifecycle_state IS DISTINCT FROM 'superseded';
