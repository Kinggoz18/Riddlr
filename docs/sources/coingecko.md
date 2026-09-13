# CoinGecko

Official CoinGecko `/coins/markets` adapter for watchlist quotes. Optional
operator demo API key. This is read-only market data, not a news source.

Setup creates a CoinGecko source on the default agent with Bitcoin, Ethereum,
and Tether. Watchlist canonical IDs (`coingecko:bitcoin`) drive the ids query.
Enabling CoinMarketCap or Crypto.com Exchange pauses CoinGecko. Only one
market-data source is active at a time. On-chain scanning is not implemented.

The same API also seeds the asset registry used by watchlist search and text
extraction. See [integrations/coingecko.md](../integrations/coingecko.md).
