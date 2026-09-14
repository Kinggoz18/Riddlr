# Testing

```bash
pnpm test:unit
pnpm test:integration
pnpm compose:smoke
pnpm licenses:check
```

Unit tests cover domain registry, fingerprints, clustering, encryption, schema validation,
materiality, schedules, prompt wrapping, provider adapters, Discord REST
fixtures, RSS/Atom feed fixtures, DefiLlama fixtures, Hyperliquid fixtures, Binance USD-M Futures fixtures, Polymarket fixtures, Kalshi fixtures, Snapshot fixtures, Alchemy ADDRESS_ACTIVITY fixtures, Helius enhanced TRANSFER fixtures, SearXNG news fixtures, X recent-search fixtures, WhatsApp session-window rules, portfolios,
skill routing, signal gating, claim corroboration, HTML extraction, enrichment
eligibility, registry-driven asset resolution, CoinGecko registry fixtures,
CoinGecko simple/price observations, return-shock, volume, TVL-drawdown, peg-deviation, market-stress, funding-divergence and odds-jump detectors, catalyst
taxonomy mapping, quantitative claim contracts, and coming-soon rejection. Architecture tests keep generic packages from importing
`@riddlr/domain-crypto`. The domain-module contract is exercised with a
test-only implementation, not a fake product domain.

Integration tests use Testcontainers for PostgreSQL and Valkey. PostgreSQL
uses a tmpfs data directory so the suite can start when the Docker VM disk is
exhausted. They cover four-step onboarding, first-run access, default-agent Crypto association,
coming-soon scan rejection, custom agents, skill privilege rejection, canonical
watchlist identity, CoinGecko registry seed and search, asset-registry migration
backfill, observation poll to series, detectors, and observed events without an
article, token-budget skip, Discord token encryption and official REST
polling, X bearer encryption and named-principal recent search, RSS/Atom feed create and poll, DefiLlama opt-in poll, Hyperliquid and Binance USD-M Futures opt-in poll, Polymarket and Kalshi opt-in poll, Snapshot opt-in poll, Alchemy and Helius inbound webhooks, SearXNG per-asset news queries, session rotation after 2FA,
recovery codes, password reset hashing, Resend settings, secret non-disclosure, notification
claim-before-send, session idle/cap, recovery rotate, key rotation with a previous
master key, WhatsApp HMAC webhooks, paginated audit/lists, audit clear,
understanding as the primary claim extractor, and catalyst kinds on event APIs.

`pnpm compose:smoke` waits until Compose answers `/api/v1/setup/status` with
four steps, five market domains, and local first-run access.

Unit tests cover first-run access helpers, setup-code lifetime (15 minutes),
and an LLM reachability probe with a mocked HTTP client. Integration tests cover
public-mode unlock, Finish enqueueing the default scan, and setup access
paths. They do not call live provider networks (`RIDDLR_ENV=test` skips the
live model check).

```bash
pnpm compose:reset
pnpm compose:smoke
```

TOTP enrollment can be skipped during first-run and enabled later in Settings.
Do not call `/setup/totp/start` after setup is complete.

Integration tests mock SearXNG, Discord, X, RSS/Atom, WhatsApp, and LLM HTTP in-process. They do not
call live provider networks. The intelligence-flow fixture returns HTML for
eligible search URLs, treats snippets as incomplete, and asserts a
repeat scan reuses evidence fingerprints and the same event row. A syndication
fixture with a shared outbound Reuters URL is not treated as independent
corroboration. Signal proof rows must match `claim_evidence`.

Playwright specs in `tests/e2e` cover adding a watchlist asset by registry
search against a running Compose stack, the Health Observations card, opening
an observed quantitative event on Events, the catalyst kind label on that
event, and the RSS/Atom source form.
First-run credentials default to `ops@example.com`. On an already-set-up
instance, set `RIDDLR_E2E_EMAIL` and `RIDDLR_E2E_PASSWORD` (and
`RIDDLR_E2E_OTPAUTH` when authenticator is enabled). The first-run spec skips
when setup is already complete.

```bash
pnpm exec playwright test
```
