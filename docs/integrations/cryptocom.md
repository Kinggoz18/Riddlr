# Crypto.com Exchange

Crypto.com Exchange public tickers are an **opt-in** scan-time market-data
source. There is no API key. This is not an observation provider. Tickers land
as `market_data` evidence on a scan, not as `observation_series` rows.

No trading, wallet, or private endpoints. Enabling this source pauses CoinGecko
and CoinMarketCap. Only one market-data source is active at a time.

## Setup

Sources → **Add source** → **Configure Crypto.com Exchange**. One source.

Watchlist slugs map to USD spot instruments (`bitcoin` → `BTC_USD`,
`ethereum` → `ETH_USD`). Unmapped slugs use `BASE_USD` from the ticker base.

## What the adapter actually fetches

| Call | Use |
| --- | --- |
| `GET https://api.crypto.com/exchange/v1/public/get-tickers?instrument_name=` | Last (`a`), 24h volume (`vv`), 24h change (`c`) |

One request per mapped instrument per scan, bounded by `MAX_MARKET_IDS`.

Official docs:
https://exchange-developer.crypto.com/exchange/v1/docs/api/rest/public-get-tickers

| Item | Value |
| --- | --- |
| Adapter | `cryptocom` |
| Family | `market_data` |
| Licence | Public REST; operator-local cache only |
| Mapping | Evidence `canonicalId` = `coingecko:<slug>` when the base maps |

## Agent application

A Crypto agent with this source attached receives ticker snapshots on each
scan. The rows are context on events. They do not open `observed` events.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `malformed` | Envelope `code` not 0, or no last prices | Confirm the instrument still lists |
| `unavailable` | 5xx, timeout | Check api.crypto.com |
| `rate_limited` | HTTP 429 | Wait for the next scan |

A failed instrument does not drop other instruments on the same scan.

## Fixtures

No recorded HTTP capture is in the tree. The unit test parses an in-memory
`public/get-tickers` envelope for `BTC_USD`.
