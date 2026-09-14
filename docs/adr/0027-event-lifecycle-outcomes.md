# Event lifecycle and outcomes

Events keep a rolling-window identity of market domain, catalyst kind, and
subject canonical ID. A later cluster joins an open event with that key when it
is inside the domain join window and shares a claim fingerprint or passes the
shingle test against principal evidence. Unlabeled clusters fall back to content
hashes. Duration kinds do not reopen after `resolved`. Scheduled kinds
(`token_unlock`, `scheduled_release`, `governance_proposal`) reopen when the
same claim fingerprint returns with a changed scheduled date. Two open events
with the same key merge into the older row; the newer row becomes `superseded`.
A registry refresh that re-canonicalises a subject leaves the event on the
original ID and matches through aliases.

Lifecycle states are `open`, `developing`, `confirmed`, `disputed`, `retracted`,
`resolved`, and `superseded`. Scan processing status (`needs_analysis`,
`candidate`, and the rest) stays on `events.status`. Lead time is
`firstPrimaryAt − firstObservedAt` for official-firsthand evidence. Outcomes at
+1h, +24h, and +7d after `firstNotifiedAt` record price, funding, and TVL deltas
from `observation_series` with no trading interpretation. The scorecard API and
Scorecard page expose emitted, later confirmed, later retracted, median lead,
and median +24h spot move.

**Status:** accepted
