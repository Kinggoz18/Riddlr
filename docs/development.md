# Development

Node 22+, pnpm 10.

```bash
docker compose up postgres valkey searxng mailpit
pnpm install
pnpm db:migrate
pnpm dev
```

API: http://localhost:3001  
Web: http://localhost:5173 (proxies `/api` to the API)

Native setup talks to the API on loopback. `RIDDLR_SETUP_ACCESS=public` does
not show the setup-code card here. Use Compose `--public` to try that gate.

Run the worker as well if you want Finish to collect evidence (`pnpm --filter
@riddlr/server exec node dist/cmd/worker.js` after a server build, or use
Compose).

Production-shaped path remains `./scripts/riddlr-up.sh` (dashboard on
http://127.0.0.1:8080). Windows: `scripts/riddlr-up.ps1`. Host first-run:
`docker compose exec -it api node apps/server/dist/cmd/onboard.js`.

`RIDDLR_MAX_AGENTS` defaults to 16. `RIDDLR_DEFAULT_TOKEN_BUDGET` defaults to
100000 daily prompt-plus-completion tokens per agent. An agent may set its
daily budget to unlimited (`null`); analysis is then not skipped for a daily
cap, and usage is still recorded.
