# SearXNG

Riddlr ships a local SearXNG container with JSON format enabled. Public
instances often disable JSON and will return 403.

The search API parameters used: `q`, `categories`, `language`, `pageno`,
`time_range`, `format=json`. URL allow/block lists are applied in Riddlr after
fetch. `unresponsive_engines` is a partial success, not a failed scan.

Official docs: https://docs.searxng.org/dev/search_api.html
