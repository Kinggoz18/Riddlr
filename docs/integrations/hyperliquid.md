# Hyperliquid

Hyperliquid is an **opt-in** observation source for perpetual funding, open
interest, mark price, premium, and 24h notional volume. There is no API key.

## Setup

Sources → **Add source** → **Configure Hyperliquid**. One source. The observe
worker polls once per minute (minimum 30s, maximum 15 minutes).
`RIDDLR_ENV=test` does not enqueue; tests call `pollObservationProvider`.

Watchlist and portfolio assets map by unique registry symbol. Ambiguous
symbols (`ONE`, `GAS`, `SUN`, `AI`) are skipped. Unmapped coins are stored
only when pinned as `hyperliquid:<COIN>`. The full universe is not persisted.

## What the provider actually fetches

| Call | Use |
| --- | --- |
| `POST https://api.hyperliquid.xyz/info` `{"type":"metaAndAssetCtxs"}` | Positional `universe[i].name` with `assetCtxs[i]` |
| `POST https://api.hyperliquid.xyz/info` `{"type":"predictedFundings"}` | Next funding for `HlPerp` and `BinPerp` |

Verified 2026-09-14: `metaAndAssetCtxs` weight 20 on a ~1,200 weight/min IP
limit; one call returns every perp. `predictedFundings` `BinPerp` rows include
`fundingIntervalHours` (8 for BTC). Redirects are not followed. Bodies over
2 MB are rejected.

Official docs:
https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals

| Item | Value |
| --- | --- |
| Adapter / provider | `hyperliquid` |
| Family | `observation` |
| Licence | Public info endpoint, no key |
| Metrics | `funding_rate_1h`, `funding_rate_apr`, `funding_predicted_apr`, `funding_predicted_binance_apr`, `open_interest`, `open_interest_usd`, `mark_price`, `premium`, `volume_24h_usd` |

Hourly funding is stored at the UTC hour so a 7-day z-score fits in
`MAX_SERIES_WINDOW` (512). `market_stress.v1` fires when hourly
`funding_rate_apr` sample z-score is beyond ±3σ after 20 hourly points (target
window 168 ≈ 7 days), or when `open_interest_usd` moves at least 20% in 1h.
`funding_divergence.v1` compares Hyperliquid and Binance annualised APR (10
percentage points). Findings are `crypto:market_stress` observed events, impact
`moderate` on a watched asset, never a validated signal. Open-event merge of
liquidation bursts waits on event lifecycle; this source still emits the
observation.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429 | Wait for the next interval |
| `unavailable` | 5xx, timeout, redirect, or HTML body | Check api.hyperliquid.xyz |
| `malformed` | Non-array body, or universe/assetCtxs length mismatch | Schema drift; no silent zero |
| `too_large` | Body over 2 MB | Skip the poll |
| `source_disabled` | No enabled Hyperliquid source | Add the source; it is not auto-created |

## Fixtures

Captured 2026-09-14 from `https://api.hyperliquid.xyz/info`. See
`packages/source-adapters/test/fixtures/README.md`.
