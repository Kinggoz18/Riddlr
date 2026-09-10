# Bounded-memory processing

Ingestion, correlation, analysis, HTTP lists, and the scheduler must not hold
an unbounded number of source items, events, prompts, or cached objects in
process memory. Pages clamp to 100. Scans cap sources and evidence. Analysis
sends a bounded evidence window. Worker concurrency is configurable and
capped at 8. Benchmarks record RSS and peak RSS.

**Status:** accepted
