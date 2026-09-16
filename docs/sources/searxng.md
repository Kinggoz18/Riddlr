# SearXNG

Riddlr ships a local SearXNG container with JSON format enabled. Public
instances often disable JSON and will return 403.

Each scan issues one `categories=news` query per watched asset (name OR symbol
plus catalyst keywords), capped at 12, plus one domain-general query. Hits are
deduped by canonical URL before they are stored. Search hits are kept only when
the title or snippet resolves a watched asset or matches that market domain's
vocabulary. Search hits stay **mentions** until an eligible public page is
enriched. Operator-pasted RSS/Atom feeds are not gated.

The search API parameters used: `q`, `categories=news`, `language=en`,
`pageno`, `time_range=day`, `format=json`, and optional `engines` from Sources
→ SearXNG → Edit source. URL allow/block lists are applied after fetch.
`unresponsive_engines` is stored on the source run. It does not mark the scan
partial. The scan is partial only when a source fails while another succeeds.

Default price-tracker hosts (CoinGecko, CoinMarketCap, TradingView, and the rest
of the list under Sources → Publisher hosts) cannot produce claims. Unblock a
host there if you need its pages. CoinGecko observations still poll. Reputable
press hosts start as `reputable_press` (discovery and analysis). Official and
regulator hosts start as `official_firsthand`.

See [integrations/searxng.md](../integrations/searxng.md).

Eligible URLs are fetched with SSRF checks, robots.txt, a per-scan and per-host
cap, and a decompressed byte limit. Fetches send `User-Agent: Riddlr/0.1.0
(+https://github.com/Kinggoz18/Riddlr)` and honor `Allow`, longest-match, and a
`Riddlr` robots group. Hosts whose cached robots.txt denies the path (24h TTL)
are skipped so enrichment slots go to fetchable pages. A `Disallow: /` host such
as reuters.com stays a search mention until a feed or other complete source
covers the story.

Official docs: https://docs.searxng.org/dev/search_api.html
