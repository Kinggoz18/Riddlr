# Docker

Default Compose publishes **8080 only**. That origin serves the dashboard, API,
and webhook paths. Mailpit and SearXNG are not on the public Caddyfile.

Use `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`
to overlay the development Caddyfile (`/mailpit*`, `/searxng*`) and publish
Postgres/Valkey/Mailpit for native Node.

Services: Caddy 2.10, web (nginx 1.27), api/worker (Node 22, compiled, non-root),
postgres 17, valkey 8, searxng, mailpit v1.27.

`RIDDLR_LOCAL_COMPOSE=true` allows generated volume secrets. Production without that
flag requires `RIDDLR_COOKIE_SECRET` and `RIDDLR_ENCRYPTION_MASTER_KEY`.

Postgres and Valkey are not published on localhost in the default file.

Completed setup is stored in the Postgres volume. Wipe the instance with:

```bash
pnpm compose:reset
```
