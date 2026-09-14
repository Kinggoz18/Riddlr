# Extending connectors

Implement `SourceAdapter` in `packages/source-adapters`. Advertise capabilities.
Normalize to the generic evidence envelope. Do not import `@riddlr/domain-crypto`
or `@riddlr/domain-equities`.

Register the adapter in `apps/server`. Domain-specific extraction belongs in a
domain module, not the adapter. Advertise lookback honestly. Do not assume
archive or plan-gated endpoints are available.
