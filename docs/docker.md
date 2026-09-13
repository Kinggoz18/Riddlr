# Docker

Default Compose publishes **127.0.0.1:8080 only**. That origin serves the
dashboard, API, and webhook paths. Mailpit and SearXNG are not on the public
Caddyfile.

`./scripts/riddlr-up.sh` is the start path on macOS and Linux. Windows uses
`scripts/riddlr-up.ps1`. Both check Docker, can install or start it if you
confirm (`--install-docker` / `-InstallDocker` skips the prompt), wait until
Riddlr is ready, and print an SSH command when Riddlr is on a remote server.
`--public` / `-Public` lets other devices open the URL and prints a setup code
that expires after 15 minutes if unused. See [install.md](install.md).

Give Docker at least 10 GB of disk. The start script pulls
`ghcr.io/kinggoz18/riddlr-server:latest` and `riddlr-web:latest`
(`linux/amd64` and `linux/arm64`). If that pull fails, it builds from the
clone. CI still uses `--build`. Pin a digest or version with
`RIDDLR_SERVER_IMAGE` and `RIDDLR_WEB_IMAGE`.

Use `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`
to overlay the development Caddyfile (`/mailpit*`, `/searxng*`) and publish
Postgres/Valkey/Mailpit (UI 8025, SMTP 1025) for native Node.

Services: Caddy 2.10, web (nginx 1.27), api/worker (Node 22, compiled, non-root),
postgres 17, valkey 8, searxng, mailpit v1.27.

`RIDDLR_LOCAL_COMPOSE=true` allows generated volume secrets. Production without that
flag requires `RIDDLR_COOKIE_SECRET` and `RIDDLR_ENCRYPTION_MASTER_KEY`.

Postgres and Valkey are not published on localhost in the default file.

Completed setup is stored in the Postgres volume. Wipe the instance with:

```bash
pnpm compose:reset
```
