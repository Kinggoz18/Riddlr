# Binance USD-M Futures

Binance USD-M Futures is an **opt-in** observation source for perpetual
funding, open interest, long/short ratio, and 1-minute liquidation notional.
Public market data needs no key.

## Setup

Sources → **Add source** → **Configure Binance USD-M Futures**. One source.
Optional quote assets (default `USDT`, `USDC`, `BUSD`) are stripped from
symbols such as `BTCUSDT`. Polls `premiumIndex` every minute; open interest
and long/short ratio every 5 minutes. Liquidations arrive on
`wss://fstream.binance.com/ws/!forceOrder@arr` in the observe worker (not in
`RIDDLR_ENV=test`).

`RIDDLR_ENV=test` does not enqueue; tests call `pollObservationProvider`.

## What the provider actually fetches

| Call | Use |
| --- | --- |
| `GET https://fapi.binance.com/fapi/v1/premiumIndex` | All-symbol mark, index, last funding |
| `GET https://fapi.binance.com/futures/data/openInterestHist?symbol=&period=5m&limit=1` | Preferred USD notional |
| `GET https://fapi.binance.com/fapi/v1/openInterest?symbol=` | Fallback contracts × mark |
| `GET https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=&period=5m&limit=1` | Context `long_short_ratio` |
| `wss://fstream.binance.com/ws/!forceOrder@arr` | Bounded 1-minute liquidation notional |

Verified 2026-09-14: published request weight 2,400/min/IP; `premiumIndex`
all-symbols weight 10; `openInterest` weight 1. Honor `X-MBX-USED-WEIGHT-1M`
and stop further OI calls at 2,000. HTTP 429 and 418 back off `Retry-After`.
HTTP 451 means this region cannot reach the venue — disable the source.
`{"code":-1121}` unknown symbol is `capability_missing` for that symbol only.

This operator environment could not resolve `fapi.binance.com` or
`fstream.binance.com` (NXDOMAIN). REST fixtures were captured from
`https://testnet.binancefuture.com` (same JSON shape as production). Force-order
frames were captured from `wss://stream.binancefuture.com/ws/!forceOrder@arr`.
The adapter still calls the documented production hosts. `/futures/data/*` on
the testnet host 301s to an HTML demo page; the adapter does not follow
redirects and falls back to `/fapi/v1/openInterest` × mark for USD notional.

Official docs:
https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api

| Item | Value |
| --- | --- |
| Adapter / provider | `binance-futures` |
| Family | `observation` |
| Licence | Public market data, no key |
| Metrics | `funding_rate_8h`, `funding_rate_apr`, `mark_price`, `open_interest`, `open_interest_usd`, `long_short_ratio`, `liquidations_1m_usd` |

Do not compare raw 8h Binance funding to Hyperliquid 1h funding. Both series
also store `funding_rate_apr` (365×24 / period hours). `market_stress.v1` and
`funding_divergence.v1` are described in
[hyperliquid.md](hyperliquid.md). Cross-venue liquidation bursts attach to an
open fundamental event only after event lifecycle exists; v1 still emits
observation evidence and a `market_stress` observed event (impact
`informational`, typed perp-stress early warning)
when 1-minute liquidation notional is at least $10,000,000 on a watched asset.

Dropped WebSocket frames are counted on `riddlr_observe_ws_drops_total`.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429 or 418 | Wait; Retry-After is stored |
| `blocked` | HTTP 451 | Disable the source; venue blocked in this region |
| `unavailable` | 5xx, timeout, DNS, redirect, or HTML | Check fapi.binance.com |
| `malformed` | premiumIndex row missing `markPrice` | Schema drift; no silent zero |
| `capability_missing` | `{"code":-1121}` | That symbol is skipped |
| `source_disabled` | No enabled Binance futures source | Add the source; it is not auto-created |

## Fixtures

Captured 2026-09-14. See `packages/source-adapters/test/fixtures/README.md`.
