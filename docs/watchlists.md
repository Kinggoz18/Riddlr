# Watchlists

A watchlist belongs to one agent. Items are **canonical asset IDs**, such as
`coingecko:bitcoin`, not bare tickers.

The Crypto module resolves each item through the `assets` registry. Unknown
IDs and inactive (unwatched, out of top N) ids are rejected. The instance cap
is 50 items per watchlist.

The dashboard picker searches the registry by name, symbol, or cashtag.
Canonical IDs are stored underneath. Bootstrap rows cover Bitcoin, Ethereum,
Tether, USD Coin, and Solana before the first CoinGecko seed. After a seed,
any of the top N assets can be added.

Overview and agent boards show the first eight named assets, then a View more
link, and the latest CoinGecko spot quote when `observation_series` has a row.
Overview morning cards list each watched asset with a spot chart when series
rows exist. Open an asset to see funding, open interest, TVL, events, and
evidence. **Watchlists** lists every agent watchlist; open a list to see the full
set. Edit assets on the agent.

Scan search queries use watchlist symbols and names when the list is not empty.
The default agent is seeded with Bitcoin, Ethereum, and Tether. Context notes
include the watchlist. Watchlists do not invent market metrics.

See [integrations/coingecko.md](integrations/coingecko.md) for seed interval,
top N, and failure classes.
