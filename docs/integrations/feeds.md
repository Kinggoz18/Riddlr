# RSS and Atom feeds

Riddlr polls operator-supplied RSS 2.0 and Atom 1.0 URLs as evidence sources.
There is no feed scraping of HTML pages. Linked pages go through the existing
enrichment path when they are fetchable.

## Setup

Sources → **Add source** → **Configure RSS/Atom**. Paste an `http` or `https`
feed URL. You can add more than one feed. The default Crypto agent starts with
Ethereum Foundation, CoinDesk, and Decrypt feeds. Suggested official URLs
(Federal Reserve press releases, ECB press) default trust to **official
firsthand**. Other URLs default to **community** unless the hostname matches a
starter feed. Trust is stored on the feed hostname identity and can be changed
later under Source identities.

Poll interval is 60–3600 seconds (default 300). Unchanged `ETag` responses
double the interval up to one hour.

## What the adapter actually fetches

`GET` the feed URL with `If-None-Match` and `If-Modified-Since` when a previous
poll stored those headers. Response cap 2 MB. Redirects are followed with an
SSRF check on each hop (max 3). XML DTD and external entities are rejected.

Each new `item` or `entry` is keyed by `guid`/`id` or canonical link. Title,
summary, author, and published time are stored. RSS `content:encoded` or Atom
`content` of at least 400 characters is stored as `native_complete` and is not
fetched again. Other items are snippets; enrichment may fetch the item link.
The source identity platform is `feed` and `externalId` is the feed hostname.

| Item | Value |
| --- | --- |
| Adapter | `feeds` |
| Family | `feed` |
| Licence | Per feed publisher; operator-local cache only |
| Mapping | Evidence; `native_complete` when encoded content is ≥400 characters; otherwise snippet until enrichment |

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429. Message includes `Retry-After` when the feed sent it. | Wait for the next scan. |
| `blocked` | 401/403 (paywalled), 451 (geo), or a redirect to a blocked host | Use a public feed URL. |
| `unavailable` | 5xx | Check the publisher; the scan continues with other sources. |
| `timeout` | Abort after 15s | Retry on the next scan. |
| `malformed` | HTML 200, non-RSS/Atom body, or DTD | Confirm the URL returns RSS 2.0 or Atom 1.0. |
| `too_large` | Body over 2 MB | Pick a narrower feed. |

A failed poll writes no items. HTTP 304 writes nothing and backs off. Watchlist
changes during a poll do not drop items: every parsed item is stored up to the
scan evidence bound. Asset resolution happens after persist, so a symbol that
maps to two registry rows is not decided in this adapter.

## Fixtures

Captured 2026-09-14. See `packages/source-adapters/test/fixtures/README.md`.
