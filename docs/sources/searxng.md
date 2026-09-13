# SearXNG

Riddlr ships a local SearXNG container with JSON format enabled. Public
instances often disable JSON and will return 403.

The search API parameters used: `q`, `categories`, `language`, `pageno`,
`time_range`, `format=json`. URL allow/block lists are applied in Riddlr after
fetch. `unresponsive_engines` is a partial success, not a failed scan.

Every search hit is a **search mention** until an eligible public page is
enriched. Snippets cannot corroborate a claim. Eligible URLs are fetched with
SSRF checks, robots.txt, a per-scan and per-host cap, and a decompressed byte
limit. Main content is cleaned once; unchanged cleaned content is not sent to
the model again.

Publisher host policy (Sources) can block enrichment. Blocked hosts stay
discovery-only. Two hosts reprinting one origin count as one origin.

Official docs: https://docs.searxng.org/dev/search_api.html
