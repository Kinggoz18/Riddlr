# CoinMarketCap

CoinMarketCap is an **opt-in** scan-time market-data source. It is not an
observation provider. Quotes land as `market_data` evidence on a scan, not as
`observation_series` rows. Detectors read CoinGecko `/simple/price` series.

Requires `X-CMC_PRO_API_KEY`. Enabling CoinMarketCap pauses CoinGecko and
Crypto.com Exchange. Only one market-data source is active at a time.

## Setup

Sources → **Add source** → **Configure CoinMarketCap**. Paste a Pro API key.
The key is stored encrypted and never returned.

Watchlist canonical ids stay `coingecko:<slug>`. The adapter queries by slug.

## What the adapter actually fetches

| Call | Use |
| --- | --- |
| `GET https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/latest?slug=&convert=USD` | USD last, 24h volume, market cap, percent change |

Official docs: https://coinmarketcap.com/api/documentation/v1/

| Item | Value |
| --- | --- |
| Adapter | `coinmarketcap` |
| Family | `market_data` |
| Licence | CoinMarketCap Pro terms; operator-local use; no redistribution |
| Mapping | Evidence `canonicalId` = `coingecko:<slug>` |

`GET /v1/global-metrics/quotes/latest` and `GET /v1/cryptocurrency/map` are
not shipped. CoinGecko remains the registry seed.

## Agent application

A Crypto agent with this source attached receives one quotes poll per scan for
watchlist slugs. The rows are context on events. They do not open
`observed` events. Return-shock and volume detectors still need CoinGecko spot
observations.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `auth` | Missing key, or HTTP 401 | Paste a Pro API key |
| `rate_limited` | HTTP 429 | Wait; check the plan credit cap |
| `unavailable` | 5xx, timeout | Check CoinMarketCap status |
| `malformed` | No USD quote rows, or empty slug list | Confirm watchlist slugs |

A failed poll writes no quote evidence.

## Fixtures

No recorded HTTP capture is in the tree. Unit tests parse in-memory v3 quote
envelopes (array `data` and id-keyed `data`). Live capture needs a Pro key.
