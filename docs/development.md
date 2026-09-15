# Development

Node 22+, pnpm 10.

## Native (API + worker + Vite)

Postgres, Valkey, SearXNG, and Mailpit ports below are the native defaults.
Cookie and encryption secrets are generated on first start. Copy
`.env.example` to `.env` only when you need to override them.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up postgres valkey searxng mailpit
pnpm install
pnpm db:migrate
pnpm dev
```

`pnpm dev` starts the API, the BullMQ worker, and the Vite dashboard. Finish,
scans, observations, analysis, and notifications need the worker. Run
`pnpm --filter @riddlr/server dev` if you only want the API.

API: http://localhost:3001
Web: http://localhost:5173 (proxies `/api`, `/hooks`, `/healthz`, and `/readyz`
to the API)
SearXNG JSON: http://127.0.0.1:8888
Mailpit UI: http://127.0.0.1:8025
Mailpit SMTP: `smtp://127.0.0.1:1025`

Set `RIDDLR_SMTP_URL` for password-reset mail, or save Resend in Settings.

Native setup talks to the API on loopback. `RIDDLR_SETUP_ACCESS=public` does
not show the setup-code card here. Use Compose `--public` to try that gate.

Do not start the full Compose stack and native `pnpm dev` against the same
published Postgres port at the same time.

## Compose (production-shaped)

`./scripts/riddlr-up.sh` (dashboard on http://127.0.0.1:8080). Windows:
`scripts/riddlr-up.ps1`. Host first-run:
`docker compose exec -it api node apps/server/dist/cmd/onboard.js`.

Use `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`
to overlay the development Caddyfile (`/mailpit*`, `/searxng*`) and publish
Postgres, Valkey, Mailpit, and SearXNG (8888) for native Node.

`RIDDLR_MAX_AGENTS` defaults to 16. The Agents list shows how many of that cap
are in use. Create and Duplicate return `agent_limit` at the cap.
`RIDDLR_DEFAULT_TOKEN_BUDGET` defaults to 100000 daily prompt-plus-completion
tokens per agent. An agent may set its
daily budget to unlimited (`null`); analysis is then not skipped for a daily
cap, and usage is still recorded. `RIDDLR_REGISTRY_TOP_N` defaults to 1000
(max 2000). `RIDDLR_REGISTRY_SEED_INTERVAL_HOURS` defaults to 24 (max 168).
`RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS` defaults to 60 (max 300).
`RIDDLR_OBSERVE_RETENTION_DAYS` defaults to 90 (min 14, max 365).
