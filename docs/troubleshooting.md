# Troubleshooting

- Sign in instead of First-run setup: this instance already completed onboarding.
  Wipe volumes (`pnpm compose:reset`) only if you intend to destroy instance data.
- Setup code asked on first-run: this instance was started with a published
  dashboard. Use the code printed by `./scripts/riddlr-up.sh --public`. If
  nobody entered it within 15 minutes, print a new one:
  `docker compose exec -T api node apps/server/dist/cmd/setup-code.js`.
  If the code is lost before Finish, wipe the instance and start again.
- Bare `docker compose up` skips those checks. Use `./scripts/riddlr-up.sh`
  (Windows: `scripts/riddlr-up.ps1`).
- Git Bash on Windows cannot install Docker Desktop. Use the PowerShell script,
  or start Docker Desktop yourself and re-run.
- Can’t open http://127.0.0.1:8080 from another machine: that is expected. Use
  the SSH command from `./scripts/riddlr-up.sh`, or start with `--public`.
- Compose `ENOSPC` / API cannot write secrets / Postgres checkpoint panic: the
  Docker Desktop VM disk is full (often an 8 GB image). Reclaim unused images
  and build cache (`docker image prune -f && docker builder prune -f`), then
  `docker compose up -d`. Do not reset volumes unless you intend to wipe the
  instance. Increasing the Docker Desktop disk size avoids this on rebuilds.
- SearXNG 403: JSON format is disabled. Use the bundled container.
- Worker unhealthy: API still serves reads; scans will not run.
- Password reset locally: open Mailpit through the Compose proxy path `/mailpit`.
- LLM schema errors: the signal is rejected, the event stays `needs_analysis`.
- Daily token budget exhausted: analysis is skipped and the event stays
  `needs_analysis`. Unlimited daily usage does not skip for a cap.
- X 403 on recent search: the token's plan does not include recent search.
  Riddlr does not fall back to archive search.
- WhatsApp delivery failed: the 24-hour session window is closed and no
  approved template is configured, or Graph rejected the request.
