# Watchlists

A watchlist belongs to one agent. Items are **canonical asset IDs**, such as
`coingecko:bitcoin`, not bare tickers.

The Crypto module resolves the asset class. Unknown IDs still require the
`provider:id` form. The instance cap is 50 items per watchlist.

Scan search queries use watchlist symbols and names when the list is not empty.
Context notes include the watchlist. Watchlists do not invent market metrics.
