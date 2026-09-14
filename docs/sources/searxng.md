# SearXNG

Riddlr ships a local SearXNG container with JSON format enabled. Public
instances often disable JSON and will return 403.

Each scan issues one `categories=news` query per watched asset (name OR symbol
plus catalyst keywords), capped at 12, plus one domain-general query. Hits are
deduped by canonical URL before they are stored. Search hits stay **mentions**
until an eligible public page is enriched.

The search API parameters used: `q`, `categories=news`, `language=en`,
`pageno`, `time_range=day`, `format=json`, and optional `engines` from Sources
→ SearXNG → Edit source. URL allow/block lists are applied after fetch.
`unresponsive_engines` is a partial success, not a failed scan.

Default price-tracker hosts (CoinGecko, CoinMarketCap, TradingView, and the rest
of the list under Sources → Publisher hosts) cannot produce claims. Unblock a
host there if you need its pages. CoinGecko observations still poll.

See [integrations/searxng.md](../integrations/searxng.md).

Eligible URLs are fetched with SSRF checks, robots.txt, a per-scan and per-host
cap, and a decompressed byte limit. Main content is cleaned once; unchanged
cleaned content is not sent to the model again.

Official docs: https://docs.searxng.org/dev/search_api.html
