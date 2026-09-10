# Troubleshooting

- Sign in instead of First-run setup: this instance already completed onboarding.
  Wipe volumes (`pnpm compose:reset`) only if you intend to destroy instance data.
- SearXNG 403: JSON format is disabled. Use the bundled container.
- Worker unhealthy: API still serves reads; scans will not run.
- Password reset locally: open Mailpit through the Compose proxy path `/mailpit`.
- LLM schema errors: the signal is rejected, the event stays `needs_analysis`.
- X 403 on recent search: the token's plan does not include recent search.
  Riddlr does not fall back to archive search.
- WhatsApp delivery failed: the 24-hour session window is closed and no
  approved template is configured, or Graph rejected the request.
