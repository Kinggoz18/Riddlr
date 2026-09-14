# Polymarket

Polymarket is an **opt-in** observation source for prediction-market YES odds.
There is no API key.

## Setup

Sources → **Add source** → **Configure Polymarket**. One source. Pin Gamma
market slugs (cap 50). The observe worker polls every 15 minutes.
`RIDDLR_ENV=test` does not enqueue; tests call `pollObservationProvider`.

Watchlist names and symbols map when unique (name length at least 3). Ambiguous
two-asset matches stay on the native id `polymarket:<slug>`. Pin that native id
through `POST /api/v1/observations/pins` if the market is not on the source
form. Macro suggestions use one `events/keyset` page and keywords such as fed,
fomc, cpi, and sec.

## What the provider actually fetches

| Call | Use |
| --- | --- |
| `GET https://gamma-api.polymarket.com/events/keyset?active=true&closed=false&limit=100` | Suggest watched-asset and macro markets |
| `GET https://gamma-api.polymarket.com/markets?slug=` | Pin path: slug, YES `clobTokenIds`, `liquidityNum`, closed |
| `GET https://clob.polymarket.com/midpoint?token_id=` | Mid price 0–1 (`{"mid":"0.905"}`) |
| `GET https://clob.polymarket.com/prices-history?market=<token_id>&interval=1d&fidelity=5` | First-subscription backfill once per slug |

Verified 2026-09-14: Gamma `GET /events?offset=` is deprecated (`Warning: use
/events/keyset`). Nested `clobTokenIds`, `outcomes`, and `outcomePrices` are
often JSON strings. CLOB midpoint is the field `mid`, not `mid_price`.
`prices-history` with `interval=1d&fidelity=5` returns about 288 five-minute
points covering about 24 hours, not a 7-day window. Persist is capped at
`MAX_PRICES_HISTORY_POINTS` (512). Redirects are not followed. Bodies over 2 MB
are rejected. Cap 60 calls/min.

Official docs: https://docs.polymarket.com

| Item | Value |
| --- | --- |
| Adapter / provider | `polymarket` |
| Family | `observation` |
| Licence | Public Gamma and CLOB reads, no key |
| Metrics | `odds_yes`, `odds_change_1h`, `odds_change_24h`, `odds_liquidity_usd` |

`odds_jump.v1` fires at 15 percentage points in 1h or 25 in 24h when
`odds_liquidity_usd` is at least `$10,000`. Findings are
`crypto:macro_policy_decision` or `crypto:regulatory_action` observed events,
impact `low`, or `moderate` when Polymarket and Kalshi jump on the same subject
and the asset is watched. They are never a validated signal.

Closed markets (`closed:true` or `active:false`) are unsubscribed via
`persistConfig.closedSlugs`. Missing YES token ids are `malformed` for that
market only.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429 | Wait for the next interval |
| `unavailable` | 5xx, timeout, redirect, or HTML body | Check gamma-api.polymarket.com and clob.polymarket.com |
| `malformed` | Non-object market, missing slug, or missing `clobTokenIds` | Schema drift; no silent zero |
| `capability_missing` | Empty markets array for a pinned slug | Remove the slug |
| `too_large` | Body over 2 MB | Skip that call |
| `source_disabled` | No enabled Polymarket source | Add the source; it is not auto-created |

## Fixtures

Captured 2026-09-14 from Gamma and CLOB. See
`packages/source-adapters/test/fixtures/README.md`.
