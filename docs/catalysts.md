# Catalyst taxonomy

Cross-domain event kinds live in `packages/domain`. Domain modules map their
claim kinds onto this list. Signal `eventType` must be one of these kinds.

## Kinds

| Kind | Severity prior | Quantitative | Subject |
| --- | --- | --- | --- |
| `security_incident` | critical | no | required |
| `insolvency_or_withdrawal_halt` | critical | no | required |
| `peg_deviation` | critical | yes | required |
| `token_unlock` | high | yes | required |
| `listing_or_delisting` | moderate | no | required |
| `governance_proposal` | moderate | no | required |
| `regulatory_or_legal_action` | high | no | required |
| `sanction` | high | no | required |
| `macro_policy_decision` | high | no | not required |
| `scheduled_release` | moderate | no | not required |
| `insider_transaction` | high | no | required |
| `material_corporate_event` | high | no | required |
| `earnings_or_guidance` | high | yes | required |
| `large_transfer` | moderate | yes | required |
| `market_stress` | high | yes | required |
| `observed_anomaly` | moderate | yes | required |
| `principal_statement` | moderate | no | required |

Quantitative kinds require `value` and a `unit` from `percent`, `usd`, `votes`,
`tokens`, `bps`, or `iso_date`. Subject-free kinds are `macro_policy_decision`
and `scheduled_release`.

## Extraction

Full documents only. Snippets never produce claims.

1. Deterministic first pass (regex) for cheap pre-filter and negation.
2. Cached LLM content understanding as the primary structured extractor, with
   the taxonomy as the allowed claim kinds. Source text is wrapped as untrusted
   data. The prompt lists allowed `subjectCanonicalId` values from the watchlist
   and resolver hits for that document (cap 12). Off-domain documents must return
   `claims: []`.
3. Domain `normalizeClaim` maps taxonomy kinds onto domain claim kinds and
   rejects incomplete quantitative claims, unknown units, and any
   `subjectCanonicalId` that is not in the allowed set or the asset registry.
   Claims are not persisted when the model labels the page `market_profile`,
   `promotion`, `opinion`, or `documentation`.

If understanding is unavailable or returns no valid claims, persistable first-pass
claims are stored. `observed_anomaly` is not accepted on the document path;
detectors emit it on the observe path. Non-cached understanding calls are recorded
in `ai_usage_events` and count toward the agent daily token budget.

## Crypto mapping

Crypto stores namespaced claim kinds. Operators see the taxonomy kind on Events
and Signals.

| Crypto claim kind | Taxonomy |
| --- | --- |
| `crypto:security_incident` | `security_incident` |
| `crypto:insolvency` | `insolvency_or_withdrawal_halt` |
| `crypto:stablecoin_peg_change` | `peg_deviation` |
| `crypto:token_unlock` | `token_unlock` |
| `crypto:listing_or_delisting`, `crypto:market_move` | `listing_or_delisting` |
| `crypto:governance_proposal` | `governance_proposal` |
| `crypto:regulatory_action` | `regulatory_or_legal_action` |
| `crypto:sanction` | `sanction` |
| `crypto:macro_policy_decision` | `macro_policy_decision` |
| `crypto:scheduled_release` | `scheduled_release` |
| `crypto:service_outage`, `crypto:material_corporate_event` | `material_corporate_event` |
| `crypto:large_transfer` | `large_transfer` |
| `crypto:market_stress` | `market_stress` |
| `crypto:observed_spot_price_anomaly`, `crypto:observed_quoted_volume_anomaly` | `observed_anomaly` |
| `crypto:principal_statement` | `principal_statement` |

`crypto:general_report` is rejected.

## Equities mapping

| Equities claim kind | Taxonomy |
| --- | --- |
| `equities:earnings` | `earnings_or_guidance` |
| `equities:insider_transaction` | `insider_transaction` |
| `equities:listing_or_delisting` | `listing_or_delisting` |
| `equities:insolvency` | `insolvency_or_withdrawal_halt` |
| `equities:officer_change`, `equities:impairment_or_exit`, `equities:ownership_change`, `equities:material_corporate_event` | `material_corporate_event` |

`equities:general_report` is rejected. Form 4 is `insider_transaction` and is
never high impact alone. 8-K items `2.02` and `1.03` default high. See
[integrations/edgar.md](integrations/edgar.md) and
[adr/0031-equities-domain.md](adr/0031-equities-domain.md).

See [ADR 0026](adr/0026-catalyst-taxonomy.md) and
[ADR 0028](adr/0028-typed-signal-policies.md).
