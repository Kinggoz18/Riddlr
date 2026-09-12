# Release checklist

Before tagging a release:

1. `pnpm check` (lint, typecheck, unit tests, license graph).
2. `pnpm test:integration` when Docker can start PostgreSQL and Valkey.
   Integration tests mount Postgres data on tmpfs so they can run when the
   Docker VM overlay is full.
3. `pnpm compose:reset` then `pnpm compose:smoke` after the Docker VM has free
   disk. Smoke expects four setup steps and five market domains.
4. Confirm Compose publishes only `127.0.0.1:8080` unless `--public` was used.
   Confirm an unused `--public` setup code expires after 15 minutes.
5. Confirm coming-soon domains cannot start scans or agents.
6. Confirm no private keys, seed phrases, or executable coming-soon domains
   ship in the tree.
7. Record RSS and peak RSS in [benchmarks.md](benchmarks.md) only from a real
   measurement run. Do not invent latency or throughput targets.
8. Push a `v*` tag (or run the `images` workflow) so Compose can pull
   `ghcr.io/kinggoz18/riddlr-server` and `riddlr-web`. Make those GitHub packages
   public, or unauthenticated `docker compose pull` fails and the start script
   builds from the tree.

Long-history list queries (`events`, `signals`, `evidence`, `audit`, `scans`,
`observations`) use descending timestamp indexes.
