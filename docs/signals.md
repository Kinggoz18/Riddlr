# Signals

A signal must include SIGNAL, PROOF (claim IDs and evidence IDs on the event),
ACTION, and RISK. `eventType` is a catalyst taxonomy kind and must match a
kind on the event. Missing or foreign evidence IDs or claim IDs fail closed. The
dashboard shows proof without extra navigation.

Reliability (mention, single-source, corroborated, primary-confirmed, disputed,
retracted) and impact are computed in application code. The model cannot promote
reliability or declare notification eligibility.

An **unverified early warning** is a high-impact operator-trusted firsthand
report with no independent corroboration. It is labelled Unverified early
warning in the dashboard and notifications. Enable it under Settings →
Notifications. Confirmation, dispute, and retraction use distinct notification
kinds. Shadow assessments persist the same reliability path without sending
notifications.

Events keep a rolling-window identity and a lifecycle (`open`, `developing`,
`confirmed`, `disputed`, `retracted`, `resolved`, `superseded`). Lead time is
the gap from first observation to first official-firsthand primary. Outcomes at
+1h, +24h, and +7d after first notification record price, funding, and TVL
deltas. Scorecard is at Scorecard in the dashboard.

See [docs/catalysts.md](catalysts.md).
