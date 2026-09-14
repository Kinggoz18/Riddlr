# OpenFIGI

OpenFIGI maps tickers and ISINs to FIGI identifiers for the equities registry.
There is no required key. Optional header `X-OPENFIGI-APIKEY` raises limits.

Without a key: 25 requests/min and 10 jobs per request. With a key: 250
requests/min and 100 jobs per request. FIGIs are cached on
`assets.externalIds` and are not refreshed on a schedule beyond those limits.

Live mapping is skipped when `RIDDLR_ENV` is `test`.

## Setup

No source card. Mapping runs when an Equities watchlist item is added and
during the daily company-tickers seed for watched and default issuers that
have no FIGI yet. Unmapped and multi-match tickers show as **identifier
unresolved** on the watchlist.

Jobs use `{ idType: "TICKER", idValue, exchCode: "US" }` unless the registry
row already stores another exchange code.

## What the adapter actually fetches

| Call | Use |
| --- | --- |
| `POST https://api.openfigi.com/v3/mapping` | Array of mapping jobs. Returns `figi`, `compositeFIGI`, `shareClassFIGI`, `name`, `ticker`, `exchCode`. |

A per-job `warning` or `error`, or an empty `data` array, leaves that asset
unmapped. Multiple remaining matches after exchange qualification are
`multi_match`.

Verified 2026-09-14: `AAPL` + `exchCode: US` maps to `BBG000B9XRY4`.
`NOTATICKERXYZ` returns `No identifier found.` `SAN` without exchange
qualification is a multi-match; `exchCode: US` selects `BBG000BTJS47`.

Official docs: https://www.openfigi.com/api/documentation

| Item | Value |
| --- | --- |
| Kind | Registry mapping |
| Licence | Public mapping API; optional key |
| Mapping | `figi`, `compositeFigi`, `figiStatus` on `assets.externalIds` |

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `unmapped` | Watchlist shows identifier unresolved | Confirm the ticker and exchange |
| `multi_match` | Watchlist shows identifier unresolved | Qualify the exchange; OpenFIGI returned more than one remaining match |
| `unavailable` | HTTP 5xx, timeout, or redirect | Retry on the next watchlist save or seed |
| `malformed` | Mapping body is not an array, or a job row is not an object | Schema drift; that job is skipped |
| `rate_limited` | HTTP 429 | Wait; unauthenticated cap is 25 requests/min |

## Fixtures

Captured 2026-09-14. See
`packages/source-adapters/test/fixtures/README.md`.
