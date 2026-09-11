# Crypto.com Exchange

Public Exchange v1 REST only: `GET https://api.crypto.com/exchange/v1/public/get-tickers`.
See the [REST introduction](https://exchange-developer.crypto.com/exchange/v1/docs/api/rest-introduction)
and [public/get-tickers](https://exchange-developer.crypto.com/exchange/v1/docs/api/rest/public-get-tickers).

No trading, wallet, or private endpoints. No API secret. Spot USD instruments
such as `BTC_USD` map from watchlist slugs (`bitcoin` → `BTC_USD`).

Enabling this source pauses CoinGecko and CoinMarketCap. Only one market-data
source is active at a time.
