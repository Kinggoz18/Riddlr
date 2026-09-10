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

Production-shaped path remains `docker compose up --build` on port 8080.

`RIDDLR_MAX_AGENTS` defaults to 16. `RIDDLR_DEFAULT_TOKEN_BUDGET` defaults to
8000 daily prompt-plus-completion tokens per agent.
