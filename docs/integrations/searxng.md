# SearXNG

Riddlr uses the bundled SearXNG container as the web-discovery evidence source.
JSON format is enabled in `docker/searxng/settings.yml`. Public instances that
disable JSON return 403.

## Setup

Created during onboarding. It cannot be removed. Sources → SearXNG → **Edit
source** sets an optional engine allowlist (comma-separated names such as
`bing news, reuters`). Empty means every engine enabled on the instance. The
endpoint is the Compose service URL and is not editable from the dashboard.

Publisher hosts (Sources) seed default price-tracker hostnames as blocked,
reputable press hosts as `reputable_press`, and official/regulator hosts as
`official_firsthand`. Unblock a hostname to allow its pages to produce claims.
CoinGecko `/simple/price` observations still poll when that host is blocked for
search.

## What the adapter actually fetches

`GET {SEARXNG_URL}/search?q=&format=json&categories=news&time_range=day&language=en`
and `engines=` when an allowlist is saved. Response cap 1 MB. Redirects are
not followed (`redirect: manual`).

The Crypto domain module builds one query per watched asset as
`"<name>" OR "<symbol>" (hack OR exploit OR depeg OR listing OR SEC OR lawsuit OR outage OR unlock)`,
capped at 12 assets, plus one general query
`cryptocurrency bitcoin ethereum stablecoin news (hack OR …)`. Watchlist rows
are read once at scan start. Hits across those queries are merged and deduped
by canonical URL.

Each hit is a **snippet**. Enrichment may fetch the page when the host is not
blocked.

| Item | Value |
| --- | --- |
| Adapter | `searxng` |
| Family | `search` |
| Licence | Self-hosted metasearch; publisher terms apply to each result URL |
| Mapping | Evidence snippets; claims only after enrichment on an allowed host |

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429. Message includes `Retry-After` when SearXNG sent it. | Wait for the next scan. |
| `blocked` | HTTP 451 | The instance or an upstream engine geo-blocked the query. |
| `capability_missing` | HTTP 403 | JSON format is disabled. Use the bundled container. |
| `unavailable` | 5xx | Check the SearXNG container; the scan continues with other sources. |
| `timeout` | Abort after 15s | Retry on the next scan. |
| `malformed` | HTML 200 or a non-JSON body | Confirm `/search?format=json` on the bundled instance. |
| `too_large` | Body over 1 MB | Narrow engines or wait; the scan continues. |

An empty `results` array is a successful empty fetch. `unresponsive_engines` is
partial success and still stores the hits that arrived. Duplicate URLs across
the per-asset queries persist once. A symbol that maps to two registry assets
is not decided here: queries use the watchlist canonical id, name, and symbol
already stored on the agent. Delisted assets remain on the watchlist until the
operator removes them, so their query still runs. Redirects to other hosts are
not followed. Clock skew on `publishedDate` is stored as sent; enrichment
rejects future dates.

## Fixtures

Captured 2026-09-14. See `packages/source-adapters/test/fixtures/README.md`.
