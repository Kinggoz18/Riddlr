# Benchmarks

Do not publish invented latency or throughput targets.

Record these fields with every measurement run:

- machine (CPU, RAM, OS)
- Compose profile / image tags
- dataset size (sources, evidence items, scan window)
- whether an LLM provider was configured
- `RIDDLR_WORKER_CONCURRENCY`, `RIDDLR_SCAN_EVIDENCE_LIMIT`,
  `RIDDLR_ANALYSIS_EVIDENCE_LIMIT`, `RIDDLR_ENRICH_PER_SCAN`,
  `RIDDLR_ENRICH_PER_HOST`, `RIDDLR_ENRICH_CONCURRENCY`,
  `RIDDLR_UNDERSTAND_CONCURRENCY`

Measure, when collected:

- source fan-out time
- queue wait (job queued → worker start)
- evidence throughput (items/s)
- enrichment and understanding cache hits
- database query p95 for overview/signals
- scan duration
- AI latency (provider round-trip)
- RSS and **peak RSS** of `api` and `worker` (`snapshotProcessMemory()`, also
  on `GET /api/v1/health` as `memory`). Integration scans record RSS and peak
  RSS after the mocked intelligence flow.

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

## 10 Sep 2026 — Compose, long-history lists

Conditions:

- host: Apple M2, 8 CPUs, 16 GiB RAM, Darwin 25.5.0 arm64
- Docker Desktop VM memory limit 3.826 GiB (from `docker stats`)
- Compose file: `docker-compose.yml` (default profile; `:8080` only)
- container Node: v22.23.2
- `RIDDLR_WORKER_CONCURRENCY=2`, `RIDDLR_SCAN_EVIDENCE_LIMIT=50`,
  `RIDDLR_ANALYSIS_EVIDENCE_LIMIT=20`
- LLM: an API key was stored during first-run (`sk-e2e-not-a-real-key`); no
  live provider round-trip was measured
- `pnpm compose:smoke` against `http://127.0.0.1:8080` passed
- long-history seed after first-run: 5_000 extra events and 5000 signals on
  one scan (`idempotency_key` `benchmark:long-history`)

Image tags (local `docker compose images` / RepoDigests):

| service | image |
| --- | --- |
| api | `riddlr-api:latest` `sha256:7e1853145317…` |
| worker | `riddlr-worker:latest` `sha256:71aa9f3bc4d1…` |
| web | `riddlr-web:latest` `sha256:0d407f1959e6…` |
| postgres | `postgres:17-alpine` `postgres@sha256:18cfe3ef5e68…` |
| valkey | `valkey/valkey:8-alpine` `valkey/valkey@sha256:d2e18f3410b6…` |
| caddy | `caddy:2.10-alpine` `caddy@sha256:4c6e91c6ed0e…` |
| mailpit | `axllent/mailpit:v1.27.2` `axllent/mailpit@sha256:d0ced6db8242…` |
| searxng | `searxng/searxng:latest` `searxng/searxng@sha256:2fb0fa85096f…` |

Dataset after the seed (Postgres counts):

| relation | count |
| --- | --- |
| sources | 1 |
| evidence_items | 46 |
| agents | 2 |
| scans | 4 |
| events | 5008 |
| signals | 5000 |

Process RSS is `/proc/<pid>/status` `VmRSS` / `VmHWM` of PID 1 (`node`) inside
the api and worker containers. `GET /api/v1/health` `memory` was not sampled
(the route requires a session). Cgroup `docker stats` is lower than `VmRSS`
because of shared pages.

| sample | api VmRSS | api VmHWM | worker VmRSS | worker VmHWM |
| --- | --- | --- | --- | --- |
| after first-run, before seed | 149_576 kB (146.1 MiB) | 151_540 kB (148.0 MiB) | 96_056 kB (93.8 MiB) | 146_036 kB (142.6 MiB) |
| after seed | 151_444 kB (147.9 MiB) | 151_540 kB (148.0 MiB) | 114_604 kB (111.9 MiB) | 146_036 kB (142.6 MiB) |

`docker stats --no-stream` after the seed:

| container | MemUsage |
| --- | --- |
| riddlr-api-1 | 104 MiB |
| riddlr-worker-1 | 64.83 MiB |
| riddlr-postgres-1 | 62.12 MiB |
| riddlr-searxng-1 | 138.2 MiB |
| riddlr-proxy-1 | 20.54 MiB |
| riddlr-valkey-1 | 11.06 MiB |
| riddlr-mailpit-1 | 13.93 MiB |
| riddlr-web-1 | 7.133 MiB |

List-query times are PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` **Execution
Time** for `ORDER BY … DESC LIMIT 50`, 20 samples after one warmup. p95 is
nearest-rank on that sample. Both plans used the descending timestamp indexes
(`events_window_start_idx`, `signals_created_at_idx`).

| query | p50 | p95 | min | max |
| --- | --- | --- | --- | --- |
| `events` list | 0.113 ms | 0.126 ms | 0.109 ms | 0.132 ms |
| `signals` list | 0.120 ms | 0.134 ms | 0.118 ms | 0.139 ms |

Not measured on this run: source fan-out time, queue wait, evidence
throughput, scan duration, AI provider latency.

No numeric latency or throughput targets are published.
