# Signals

A signal must include SIGNAL, PROOF (claim IDs and evidence IDs on the event),
ACTION, and RISK. `eventType` is a catalyst taxonomy kind and must match a
kind on the event. Missing or foreign evidence IDs or claim IDs fail closed. The
dashboard shows proof without extra navigation.

Application code assigns one of eight types and the proof bar for that type:

| Type | Validated when | Early warning when |
| --- | --- | --- |
| Exploit or bridge drain | On-chain tx evidence plus an independent write-up or official status | Detector alone, or one social origin |
| Stablecoin peg deviation | Detector plus issuer or exchange statement | Detector alone |
| Token unlock | Calendar evidence (`calendar` family). Always labeled anticipated | None |
| Listing or delisting | Official exchange feed | Web or social only |
| Governance proposal | Snapshot proposal evidence | None. Tally is not shipped |
| Regulatory, legal, sanction | Official document | Web only |
| Macro policy catalyst | Official text | Odds jump or principal post alone |
| Perp stress | Never a fundamental signal | Detector trip (market observation) |

Congressional trades and Form 4 are lagged filings. They are not a typed signal
and are not promoted as alpha.

Reliability (mention, single-source, corroborated, primary-confirmed, disputed,
retracted) and impact are computed in application code. The model cannot promote
reliability or declare notification eligibility.

An **unverified early warning** is a high-impact operator-trusted firsthand
report with no independent corroboration. It is labelled Unverified early
warning in the dashboard and notifications. Enable it under Settings →
Notifications. Confirmation, dispute, and retraction use distinct notification
kinds and follow the original Telegram, WhatsApp, or Discord destinations.
Shadow assessments persist the same reliability path without sending
notifications. Observation threshold alerts are labeled Observation and are
never signals.

Events keep a rolling-window identity and a lifecycle (`open`, `developing`,
`confirmed`, `disputed`, `retracted`, `resolved`, `superseded`). Lead time is
the gap from first observation to first official-firsthand primary. Outcomes at
+1h, +24h, and +7d after first notification record price, funding, and TVL
deltas. Scorecard is at Scorecard in the dashboard.

See [docs/catalysts.md](catalysts.md) and
[ADR 0028](adr/0028-typed-signal-policies.md).
