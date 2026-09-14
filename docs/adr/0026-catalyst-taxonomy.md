# Catalyst taxonomy

Claim extraction and signal `eventType` use a fixed cross-domain catalyst
kind list in `packages/domain`. Domain modules map their claim kinds onto that
list and supply impact policy. Operators see the taxonomy kind on Events and
Signals. Quantitative kinds require `value` and `unit`. Claims without a
resolvable subject are rejected unless the kind is subject-free
(`macro_policy_decision`, `scheduled_release`). Full-document understanding is
the primary structured extractor; regex is the first pass for pre-filter and
negation. Snippets never produce claims. Equities claim mapping is in
[catalysts.md](../catalysts.md).

**Status:** accepted
