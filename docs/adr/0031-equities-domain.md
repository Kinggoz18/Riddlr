# Equities domain

Equities is a supported market domain. `@riddlr/domain-equities` owns stock,
ETF, and index resolution, 8-K item and Form 4 claim mapping, and impact
policy. Generic packages do not import it. The composition root
(`apps/server`) registers the module next to Crypto.

SEC EDGAR is the Equities evidence source. Filings are native-complete with
source family `filing` and identity `{ platform: "sec", externalId: cik }` at
trust tier `official_firsthand`. The required User-Agent is
`Riddlr/<version> <operator contact email>` supplied on the EDGAR source.
OpenFIGI mapping stores FIGI values on `assets.externalIds`. Unmapped tickers
show as identifier unresolved. Canonical issuer ids are `sec:` plus a
10-digit CIK.

The default agent remains Crypto. Operators create Equities agents. Onboarding
stays four steps. Forex, Commodities, and Macro stay coming soon.

**Status:** accepted
