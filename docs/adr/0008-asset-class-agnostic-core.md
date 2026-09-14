# Asset-class-agnostic core, crypto-first product

The intelligence engine operates on Entity, Asset, Instrument, MarketDomain,
Observation, Evidence, Mention, Document, Claim, Event, Analysis, Signal,
Agent, and Source. Crypto-specific fields live in `@riddlr/domain-crypto`.
Equities-specific fields live in `@riddlr/domain-equities`. Forex,
Commodities, and Macro exist in the registry as `coming_soon` and have no
runtime module. See [0031](0031-equities-domain.md).

`packages/crypto` is cryptography. Market crypto is `@riddlr/domain-crypto`.

Generic packages must not import the Crypto domain implementation. Source
query construction, claim kinds, impact reasons, and unit normalization belong
on the registered domain module.

**Status:** accepted
