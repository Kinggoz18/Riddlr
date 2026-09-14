# Kalshi

Kalshi is an **opt-in** observation source for US-regulated prediction-market
odds. There is no API key for public market data.

## Setup

Sources → **Add source** → **Configure Kalshi**. One source. Pin series tickers
such as `KXCPI` (cap 50). Optional market tickers such as `KXCPI-26SEP-T0.6`
restrict the poll to those markets. The observe worker polls every 15 minutes.
`RIDDLR_ENV=test` does not enqueue; tests call `pollObservationProvider`.

Never fetch unfiltered `GET /series`. Pin series or markets only. Native Health
pins: `kalshi:<SERIES>` or `kalshi:<MARKET_TICKER>`.

Kalshi is the preferred source for US macro releases (CPI, FOMC, unemployment)
because those series are standardised (`KX...` tickers).

## What the provider actually fetches

| Call | Use |
| --- | --- |
| `GET https://external-api.kalshi.com/trade-api/v2/series/{series_ticker}` | Title and category |
| `GET https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=&status=open&limit=100&cursor=` | Open markets (max 5 pages) |
| `GET https://external-api.kalshi.com/trade-api/v2/markets/{ticker}/orderbook?depth=5` | Only when yes bid/ask fields are missing |

Verified 2026-09-14: listed market objects use `status: "active"` while the
filter is `status=open`; both count as subscribed. `yes_bid_dollars` /
`yes_ask_dollars` / `volume_fp` / `liquidity_dollars` are strings. Mid is
`(bid+ask)/2`. Captured CPI `KXCPI-26SEP-T0.6` mid `0.175` with
`liquidity_dollars` `0.0000`. Orderbook arrays are ascending; best bid is last;
implied yes ask is `1 - noBid`. Unfiltered `GET /series` is 16.8 MB and is not
used. `GET /events/{event_ticker}` is unused: market and series carry title,
status, and category. 404 unknown series is `capability_missing`. Redirects are
not followed. Bodies over 2 MB are rejected. Cap 30 calls/min.

Official docs: https://docs.kalshi.com/getting_started/quick_start_market_data

| Item | Value |
| --- | --- |
| Adapter / provider | `kalshi` |
| Family | `observation` |
| Licence | Public Trade API v2, no key |
| Metrics | `odds_yes`, `odds_change_1h`, `odds_change_24h`, `odds_liquidity_usd`, `volume` |

`odds_jump.v1` is identical to Polymarket. Captured `liquidity_dollars` of
`0.0000` does not meet the `$10,000` floor, so odds-jump does not fire on that
fixture; `odds_yes` and `volume` still persist. Agreement between venues on the
same subject can raise impact from `low` to `moderate` on a watched asset.

Non-open/active markets are unsubscribed via `persistConfig.closedTickers`.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429 | Wait for the next interval |
| `unavailable` | 5xx, timeout, redirect, or HTML body | Check external-api.kalshi.com |
| `malformed` | Non-object series, missing yes bid/ask, or non-list markets body | Schema drift; no silent zero |
| `capability_missing` | HTTP 404 series | Remove the ticker |
| `too_large` | Body over 2 MB | Skip that call |
| `source_disabled` | No enabled Kalshi source | Add the source; it is not auto-created |

## Fixtures

Captured 2026-09-14 from `https://external-api.kalshi.com/trade-api/v2`. See
`packages/source-adapters/test/fixtures/README.md`.
