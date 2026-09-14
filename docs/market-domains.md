# Market domains

The core intelligence engine is **asset-class agnostic**.

`MarketDomain` is contextual (Crypto, Equities, Forex, Commodities, Macro).
`AssetClass` is the instrument kind (cryptocurrency, stock, ETF, …). They are
not the same concept.

## Supported now

- **Crypto** — cryptocurrencies, meme coins, and stablecoins. Default agent
  domain. Real SearXNG source, real analysis path.
- **Equities** — stocks, ETFs, and indexes. `@riddlr/domain-equities`. SEC
  EDGAR filings (Form 4, 8-K items, EFTS) and OpenFIGI identifier mapping.
  Operators create Equities agents. Canonical ids are `sec:` plus a 10-digit
  CIK.

## Coming soon / planned

- Forex (fiat currencies, pairs)
- Commodities
- Macro (inflation, rates, employment, policy)

Coming soon means visible and **not executable**. There are no fake signals,
no placeholder integrations, and no empty domain packages.

A domain moves to `supported` only with a real module, adapters, agent profile,
UI, documentation, and tests.

The registered module owns source-query construction, claim kinds, claim
normalization, impact assessment, and the mapping from domain claim kinds onto
the cross-domain catalyst taxonomy. Generic packages do not embed
domain-specific search fallbacks. Coming-soon domains cannot start scans,
enrichment, claim extraction, analysis, or notifications.

See [docs/catalysts.md](catalysts.md).
