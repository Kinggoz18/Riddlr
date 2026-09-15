# Dashboard

Overview is the morning view. Each watched asset (cap 50) shows last spot and
24h change when those observations exist, latest funding APR and open interest
when those rows exist, open events with reliability and impact, signals since
the last Overview load, and upcoming scheduled catalysts (unlocks, votes,
releases, listings) in the next 14 days. Proof is a link to the event or
signal.

New signals since last visit use the browser `localStorage` key
`riddlr.morning.lastVisit`. The first load, an invalid timestamp, or a future
timestamp use the last 24 hours. A last visit older than seven days is clamped
to seven days. The API does not persist visits.

Asset pages are `/assets/<canonicalId>` (the colon is URL-encoded). Charts are
spot, funding APR, open interest, and TVL for the last seven days, at most 512
points each. Missing polls are gaps. Event markers, an evidence timeline,
claims, and identities that reported first sit on the same page.

Scorecard lists precision, retraction rate, and median lead by catalyst kind
and by the identity that reported first.

Charts use uPlot. Morning compact charts and asset charts show time and value
axes. See [ADR 0030](adr/0030-dashboard-charting.md).
