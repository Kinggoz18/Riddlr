INSERT INTO sources (family, adapter_id, name, enabled, config)
SELECT 'feed', 'feeds', 'Ethereum Foundation blog', true,
  '{"feedUrl":"https://blog.ethereum.org/en/feed.xml","trustTier":"official_firsthand","pollIntervalSeconds":300}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM sources
  WHERE adapter_id = 'feeds'
    AND config->>'feedUrl' = 'https://blog.ethereum.org/en/feed.xml'
);

INSERT INTO sources (family, adapter_id, name, enabled, config)
SELECT 'feed', 'feeds', 'CoinDesk', true,
  '{"feedUrl":"https://www.coindesk.com/arc/outboundfeeds/rss/","trustTier":"reputable_press","pollIntervalSeconds":300}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM sources
  WHERE adapter_id = 'feeds'
    AND config->>'feedUrl' = 'https://www.coindesk.com/arc/outboundfeeds/rss/'
);

INSERT INTO sources (family, adapter_id, name, enabled, config)
SELECT 'feed', 'feeds', 'Decrypt', true,
  '{"feedUrl":"https://decrypt.co/feed","trustTier":"reputable_press","pollIntervalSeconds":300}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM sources
  WHERE adapter_id = 'feeds'
    AND config->>'feedUrl' = 'https://decrypt.co/feed'
);

INSERT INTO agent_sources (agent_id, source_id)
SELECT a.id, s.id
FROM agents a
JOIN sources s ON s.adapter_id = 'feeds'
  AND s.config->>'feedUrl' IN (
    'https://blog.ethereum.org/en/feed.xml',
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://decrypt.co/feed'
  )
WHERE a.kind = 'system_default'
ON CONFLICT DO NOTHING;
