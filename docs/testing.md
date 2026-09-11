# Testing

```bash
pnpm test:unit
pnpm test:integration
pnpm compose:smoke
pnpm test:browser
pnpm licenses:check
```

Unit tests cover domain registry, fingerprints, clustering, encryption, schema validation,
materiality, schedules, prompt wrapping, provider adapters, Discord REST
fixtures, X recent-search fixtures, WhatsApp session-window rules, portfolios,
and coming-soon rejection. Architecture tests keep generic packages from importing
`@riddlr/domain-crypto`. The domain-module contract is exercised with a
test-only implementation, not a fake product domain.

Integration tests use Testcontainers for PostgreSQL and Valkey. PostgreSQL
uses a tmpfs data directory so the suite can start when the Docker VM disk is
exhausted. They cover four-step onboarding, default-agent Crypto association,
coming-soon scan rejection, custom agents, skill privilege rejection, canonical
watchlist identity, token-budget skip, Discord token encryption and official REST
polling, X bearer encryption and recent search, session rotation after 2FA,
recovery codes, password reset hashing, secret non-disclosure, notification
claim-before-send, session idle/cap, recovery rotate, key rotation with a previous
master key, WhatsApp HMAC webhooks, and paginated audit/lists.

Browser tests need Compose with free Docker disk, Chromium
(`pnpm exec playwright install chromium`), and an instance that has not
completed onboarding. Specs tagged `@a11y` run axe-core and fail on serious
or critical violations.

```bash
pnpm compose:reset
pnpm test:browser
```

TOTP enrollment can be skipped during first-run and enabled later in Settings.
Do not call `/setup/totp/start` after setup is complete.

Integration tests mock SearXNG, Discord, X, WhatsApp, and LLM HTTP in-process. They do not
call live provider networks.
