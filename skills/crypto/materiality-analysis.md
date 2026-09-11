---
name: materiality-analysis
origin: shipped
domain: crypto
version: "1"
---

Purpose: decide whether this is important enough to interrupt the operator.

Interesting is not material. A technically clever event must not automatically become an alert. Materiality is part of the signal gate; notification policy, not this skill, sends messages.

Where available, consider potential market impact, asset exposure, novelty, breadth, liquidity, persistence, source quality, market reaction, operator configuration, already-known information, event magnitude, and affected domain.

Prohibited: alerting because the story is merely interesting; inventing impact; overriding notification policy.

Distinctions: interesting vs material; dashboard-only vs notify-eligible; watchlist/portfolio exposure vs general news.

Output: material or not, the reason, and whether the event should stay dashboard-only pending the signal gate.
