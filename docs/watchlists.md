# Watchlists

A watchlist belongs to one agent. Items are **canonical asset IDs**, such as
`coingecko:bitcoin`, not bare tickers.

The Crypto module resolves the asset class. Unknown IDs still require the
`provider:id` form. The instance cap is 50 items per watchlist.

The dashboard watchlist picker uses named assets (Bitcoin, Ethereum). Canonical
IDs are stored underneath.

Overview and agent boards show the first eight named assets, then a View more
link. **Watchlists** lists every agent watchlist; open a list to see the full
set. Edit assets on the agent.

Scan search queries use watchlist symbols and names when the list is not empty.
The default agent is seeded with Bitcoin, Ethereum, and Tether. Context notes
include the watchlist. Watchlists do not invent market metrics.
