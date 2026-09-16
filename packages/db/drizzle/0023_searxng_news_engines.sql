UPDATE sources
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{engines}',
  '["google news","duckduckgo news","reuters","wikinews","brave.news"]'::jsonb
)
WHERE adapter_id = 'searxng'
  AND (
    NOT (config ? 'engines')
    OR config->'engines' IS NULL
    OR config->'engines' = '[]'::jsonb
    OR jsonb_typeof(config->'engines') <> 'array'
  );
