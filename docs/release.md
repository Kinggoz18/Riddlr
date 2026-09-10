# Release checklist

Before tagging a release:

1. `pnpm check` (lint, typecheck, unit tests, license graph).
2. `pnpm test:integration` when Docker can start PostgreSQL and Valkey.
   Integration tests mount Postgres data on tmpfs so they can run when the
   Docker VM overlay is full; Compose and Playwright still need free Docker disk.
3. `pnpm compose:reset` then `pnpm test:browser` on a volume that has not
   completed onboarding. The first-run test fails if First-run setup is not
   shown.
4. Confirm Compose publishes only `:8080`.
5. Confirm coming-soon domains cannot start scans or agents.
6. Confirm no private keys, seed phrases, or executable coming-soon domains
   ship in the tree.
7. Record RSS and peak RSS in [benchmarks.md](benchmarks.md) only from a real
   measurement run. Do not invent latency or throughput targets.

Long-history list queries (`events`, `signals`, `evidence`, `audit`, `scans`,
`observations`) use descending timestamp indexes.
