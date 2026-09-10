# Market domains

The core intelligence engine is **asset-class agnostic**.

`MarketDomain` is contextual (Crypto, Equities, Forex, Commodities, Macro).
`AssetClass` is the instrument kind (cryptocurrency, stock, ETF, …). They are
not the same concept.

## Supported now

- **Crypto** — cryptocurrencies, meme coins, and stablecoins. Default agent
  domain. Real SearXNG source, real analysis path.

## Coming soon / planned

- Equities (stocks, ETFs)
- Forex (fiat currencies, pairs)
- Commodities
- Macro (inflation, rates, employment, policy)

Coming soon means visible and **not executable**. There are no fake signals,
no placeholder integrations, and no empty domain packages.

A domain moves to `supported` only with a real module, adapters, agent profile,
UI, documentation, and tests.
