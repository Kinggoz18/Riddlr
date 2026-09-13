ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS market_cap_rank integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE assets
SET
  aliases = COALESCE(
    (
      SELECT jsonb_agg(DISTINCT alias)
      FROM (
        SELECT lower(assets.symbol) AS alias
        UNION ALL
        SELECT lower(assets.name)
        UNION ALL
        SELECT '$' || lower(assets.symbol)
      ) listed
      WHERE alias IS NOT NULL AND btrim(alias) <> '' AND alias <> '$'
    ),
    '[]'::jsonb
  ),
  external_ids = jsonb_strip_nulls(
    jsonb_build_object(
      'coingeckoId',
      CASE
        WHEN assets.canonical_id LIKE 'coingecko:%' THEN split_part(assets.canonical_id, ':', 2)
      END
    )
  ),
  updated_at = now()
WHERE aliases = '[]'::jsonb;

INSERT INTO assets (
  asset_class, canonical_id, symbol, name, aliases, external_ids, market_cap_rank, status
)
VALUES
  (
    'cryptocurrency',
    'coingecko:bitcoin',
    'BTC',
    'Bitcoin',
    '["btc","bitcoin","$btc","coingecko:bitcoin"]'::jsonb,
    '{"coingeckoId":"bitcoin"}'::jsonb,
    1,
    'active'
  ),
  (
    'cryptocurrency',
    'coingecko:ethereum',
    'ETH',
    'Ethereum',
    '["eth","ethereum","$eth","coingecko:ethereum"]'::jsonb,
    '{"coingeckoId":"ethereum"}'::jsonb,
    2,
    'active'
  ),
  (
    'stablecoin',
    'coingecko:tether',
    'USDT',
    'Tether',
    '["usdt","tether","$usdt","coingecko:tether"]'::jsonb,
    '{"coingeckoId":"tether"}'::jsonb,
    3,
    'active'
  ),
  (
    'stablecoin',
    'coingecko:usd-coin',
    'USDC',
    'USDC',
    '["usdc","usd coin","$usdc","usd-coin","coingecko:usd-coin"]'::jsonb,
    '{"coingeckoId":"usd-coin"}'::jsonb,
    6,
    'active'
  ),
  (
    'cryptocurrency',
    'coingecko:solana',
    'SOL',
    'Solana',
    '["sol","solana","$sol","coingecko:solana"]'::jsonb,
    '{"coingeckoId":"solana"}'::jsonb,
    7,
    'active'
  )
ON CONFLICT (asset_class, canonical_id) DO NOTHING;

INSERT INTO assets (asset_class, canonical_id, symbol, name, aliases, external_ids, status)
SELECT DISTINCT ON (watchlist_items.canonical_id)
  watchlist_items.asset_class,
  watchlist_items.canonical_id,
  watchlist_items.symbol,
  watchlist_items.name,
  COALESCE(
    (
      SELECT jsonb_agg(DISTINCT alias)
      FROM (
        SELECT lower(watchlist_items.symbol) AS alias
        UNION ALL
        SELECT lower(watchlist_items.name)
        UNION ALL
        SELECT '$' || lower(watchlist_items.symbol)
      ) listed
      WHERE alias IS NOT NULL AND btrim(alias) <> '' AND alias <> '$'
    ),
    '[]'::jsonb
  ),
  jsonb_strip_nulls(
    jsonb_build_object(
      'coingeckoId',
      CASE
        WHEN watchlist_items.canonical_id LIKE 'coingecko:%'
          THEN split_part(watchlist_items.canonical_id, ':', 2)
      END
    )
  ),
  'active'
FROM watchlist_items
ON CONFLICT (asset_class, canonical_id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS assets_canonical_idx ON assets (canonical_id);
CREATE INDEX IF NOT EXISTS assets_status_rank_idx ON assets (status, market_cap_rank);
