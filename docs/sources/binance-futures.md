# Binance USD-M Futures

Riddlr polls Binance USD-M Futures only when you add it. It is an observation
source for perpetual funding, open interest, and liquidations. It does not
replace CoinGecko spot.

Sources → **Add source** → **Configure Binance USD-M Futures**. No API key.
Funding is per 8 hours; compare Hyperliquid on annualised `funding_rate_apr`
only. HTTP 451 means this region cannot reach the venue — disable the source.

See [integrations/binance-futures.md](../integrations/binance-futures.md).
