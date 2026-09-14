# CoinMarketCap

Official CoinMarketCap Pro API `GET /v3/cryptocurrency/quotes/latest`.
Requires `X-CMC_PRO_API_KEY`. This is read-only market data, not news.

Watchlist canonical IDs stay `coingecko:bitcoin` form. The adapter queries
by slug. Enabling CoinMarketCap pauses CoinGecko and Crypto.com Exchange.
Only one market-data source is active at a time.

See [integrations/coinmarketcap.md](../integrations/coinmarketcap.md).
