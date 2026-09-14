# DefiLlama

DefiLlama is an **opt-in** observation source for protocol TVL, chain TVL,
stablecoin supply, secondary prices, and the hacks calendar. There is no API
key. Terms are personal and non-commercial: Riddlr stores results only in the
operator database and does not re-expose them on a public endpoint.

## Setup

Sources → **Add source** → **Configure DefiLlama**. One source. Pin chain names
DefiLlama uses (for example `Ethereum`) if you want chain TVL. Extra protocol
slugs are optional; watchlist `coingecko:*` ids map through `/protocols`
`gecko_id`.

The observe worker polls every 15 minutes. Hacks refresh hourly. The protocols
list refreshes daily. `RIDDLR_ENV=test` does not enqueue; tests call
`pollObservationProvider`.

## What the provider actually fetches

| Call | Use |
| --- | --- |
| `GET https://api.llama.fi/protocols` | Daily `gecko_id` → slug map |
| `GET https://api.llama.fi/protocol/{slug}` | Latest TVL point only |
| `GET https://api.llama.fi/v2/historicalChainTvl/{chain}` | Pinned chain TVL, latest point |
| `GET https://stablecoins.llama.fi/stablecoins?includePrices=true` | Circulating, price, USD peg basis |
| `GET https://coins.llama.fi/prices/current/{coins}` | Secondary `coingecko:<id>` prices, batch 100 |
| `GET https://api.llama.fi/hacks` | Hourly native-complete evidence |

Self-cap 60 calls/min and 1 concurrent request. Bodies over 5 MB are rejected.
Redirects are not followed. Official docs: https://defillama.com/docs/api.
Terms: https://defillama.com/terms.

| Item | Value |
| --- | --- |
| Adapter / provider | `defillama` |
| Family | `observation` |
| Licence | Personal, non-commercial; operator-local cache only |
| Metrics | `tvl_usd`, `chain_tvl_usd`, `stablecoin_circulating`, `stablecoin_price`, `stablecoin_basis`, secondary `spot_price` |

`tvl_drawdown.v1` fires when protocol TVL is down more than 15% in 24 hours and
the larger of the two points is at least $1,000,000. `peg_deviation.v1` fires
when `|basis| > 1%` on two consecutive polls and a CoinGecko `spot_price` is
also more than 1% from peg. Hacks map to `crypto:security_incident`. An empty
`source` field (the captured list) stores the row without an outbound origin;
a URL in `source` is recorded as derived, not independent.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429 | Wait for the next 15-minute interval |
| `unavailable` | 5xx, timeout, redirect, or HTML body | Check api.llama.fi; next interval retries |
| `malformed` | Protocol or chain payload missing `tvl` | Schema drift; no silent zero |
| `too_large` | Body over 5 MB | `/protocols` skipped; gecko_id is tried as slug |
| `source_disabled` | No enabled DefiLlama source | Add the source; it is not auto-created |

## Fixtures

Captured 2026-09-14. See `packages/source-adapters/test/fixtures/README.md`.
