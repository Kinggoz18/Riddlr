# CoinGecko

CoinGecko is used in three ways: a read-only `/coins/markets` source adapter
for watchlist quotes during scans, a daily registry seed that fills the `assets`
table, and a one-minute `/simple/price` observation poll into `observation_series`.

## Setup

Setup creates a CoinGecko source on the default agent. An optional demo API key
is stored in `encrypted_secrets` and sent as `x-cg-demo-api-key`. Enabling
CoinMarketCap or Crypto.com Exchange pauses the quote adapter. Only one
market-data source is active at a time. On-chain scanning is not implemented.

## Registry seed

The worker seeds `assets` on start and on the 60-second scheduler when
`RIDDLR_REGISTRY_SEED_INTERVAL_HOURS` has elapsed (default 24, max 168).
`RIDDLR_ENV=test` skips the live seed. Explicit `seedAssetRegistry` with an
injected fetch client is used in integration tests.

| Item | Value |
| --- | --- |
| Markets | `GET https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1…` |
| List | `GET https://api.coingecko.com/api/v3/coins/list?include_platform=true` |
| Top N | `RIDDLR_REGISTRY_TOP_N` (default 1000, max 2000) |
| Licence | CoinGecko API terms; operator-local cache only; do not redistribute |
| Mapping | `coingecko:<id>`, CAIP-19 for known EVM and Solana platforms |

Agents resolve watchlist items and extract text mentions only from this
registry. Search is `GET /api/v1/assets?q=`.

## Spot observations

The observe worker polls `GET /simple/price?ids=<up to 100>&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true` for watched, held, and pinned `coingecko:*` ids. Interval `RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS` (default 60). `RIDDLR_ENV=test` skips enqueue. Demo attribution: the dashboard footer shows "Price data by CoinGecko".

| Item | Value |
| --- | --- |
| Path | `GET https://api.coingecko.com/api/v3/simple/price` |
| Metrics | `spot_price`, `quoted_volume`, `quoted_market_cap`, `price_change_24h` |
| Observed at | `last_updated_at` when present; host time if that timestamp is more than five minutes in the future |
| Unique key | `(provider, metric, subject, observed_at, resolution)` |

See [observations.md](../observations.md).

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429. Seed and observe polls write nothing. Metrics `riddlr_registry_seeds_total` and `riddlr_observe_polls_total`. | Wait; add a demo key if you have one. A 429 body was not captured; classification uses status. |
| `unavailable` | 5xx, timeout, or a redirect (`redirect=manual`, not followed) | Check CoinGecko status; seed retries on the next due interval |
| `malformed` | HTML 200, oversized body, or a non-array JSON object | Captured 400 `invalid vs_currency` is this class |
| `lock_held` | A second seed while the 600s NX lock is held | Wait; the in-flight seed owns the write |

An id missing from a later markets page is marked `inactive` unless it is on a
watchlist or a portfolio holding. Watched ids are read after the CoinGecko
responses and before deactivation, so a watchlist add during the fetch is kept
active.

CoinGecko coin ids are unique. Platforms are fields on one list row. Repeated
market rows keep the first id after rank sort.

## Fixtures

Captured 2026-09-13. See `packages/source-adapters/test/fixtures/README.md`.
