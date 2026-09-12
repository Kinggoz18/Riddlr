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
8. Publish container images (see below) so a first start can pull instead of
   compile. Make the GHCR packages public after the first push.

Long-history list queries (`events`, `signals`, `evidence`, `audit`, `scans`,
`observations`) use descending timestamp indexes.

## Publish container images

The start script pulls `ghcr.io/kinggoz18/riddlr-server:latest` and
`riddlr-web:latest`. Those names are empty until this runs.

1. Land `main` with `.github/workflows/images.yml` and the Compose `image:`
   pins (lint must pass).
2. On GitHub: **Actions → images → Run workflow** (use `main`). A `v*` tag
   also publishes (`v0.1.0` also tags `0.1.0`). Prefer the workflow run until
   you mean to cut a release.
3. Wait until both image builds finish.
4. Open each new package → **Package settings → Change visibility → Public**:
   - https://github.com/Kinggoz18/Riddlr/pkgs/container/riddlr-server
   - https://github.com/Kinggoz18/Riddlr/pkgs/container/riddlr-web  
   New packages start **private**. There is no API for this step. Public is
   required for an unauthenticated `docker compose pull`.
5. Confirm:

```bash
docker pull ghcr.io/kinggoz18/riddlr-server:latest
docker pull ghcr.io/kinggoz18/riddlr-web:latest
```

Until step 4, the start script prints that published images are not available
and builds from the clone.
