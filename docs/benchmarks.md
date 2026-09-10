# Benchmarks

Do not publish invented latency or throughput targets.

Record these fields with every measurement run:

- machine (CPU, RAM, OS)
- Compose profile / image tags
- dataset size (sources, evidence items, scan window)
- whether an LLM provider was configured
- `RIDDLR_WORKER_CONCURRENCY`, `RIDDLR_SCAN_EVIDENCE_LIMIT`,
  `RIDDLR_ANALYSIS_EVIDENCE_LIMIT`

Measure, when collected:

- source fan-out time
- queue wait (job queued → worker start)
- evidence throughput (items/s)
- database query p95 for overview/signals
- scan duration
- AI latency (provider round-trip)
- RSS and **peak RSS** of `api` and `worker` (`snapshotProcessMemory()`, also
  on `GET /api/v1/health` as `memory`)

## 10 Sep 2026 — host process snapshot

Conditions:

- host: Darwin arm64, Node v22.23.2
- not Compose; no SearXNG scan; no LLM provider round-trip
- measurement: `snapshotProcessMemory()` in a short-lived Node process after
  importing `@riddlr/observability`

| sample | RSS | peak RSS |
| --- | --- | --- |
| after import | 69_959_680 bytes (66.7 MiB) | 69_959_680 bytes |
| after allocating 16 MiB | 86_753_280 bytes (82.7 MiB) | 86_753_280 bytes |

API and worker Compose RSS/peak RSS were not collected: the Docker VM had no
free space for a Postgres data directory (`initdb: No space left on device`).
Integration tests ran PostgreSQL on tmpfs instead.

No numeric latency or throughput targets are published. Append dated notes
when a dedicated Compose long-history run is collected. Do not invent
figures.
