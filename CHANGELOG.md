# Changelog

All notable changes to Riddlr are documented in this file.

## Unreleased

- By default the dashboard is only at `127.0.0.1:8080` on the machine that
  runs Docker. A remote server uses the SSH command printed by
  `./scripts/riddlr-up.sh`. Other devices without SSH require `--public` and a
  one-time setup code that expires after 15 minutes if unused. The onboard
  command on that machine runs the same four wizard steps.
- `./scripts/riddlr-up.sh` can install or start Docker when it is missing (Linux
  Engine, or Docker Desktop via Homebrew on a Mac) after you confirm, or with
  `--install-docker`. Windows uses `scripts/riddlr-up.ps1` (winget or
  Chocolatey for Docker Desktop).
- `scripts/install.sh` / `scripts/install.ps1` clone into `~/riddlr` and start
  Compose. They do not replace Docker.
- The start script pulls published GHCR images (`:latest`) when they exist and
  are public, otherwise it builds from the clone. Docker is still required.
  The `images` workflow publishes `linux/amd64` and `linux/arm64`.
- Finish starts the default Crypto scan. Saving a model checks that it
  answers (skipped in the test environment).
- See [install.md](docs/install.md).

## 0.6.0

- Shipped Crypto skills are composed per event. The application computes
  sourced facts and selects applicable skills; analysis does not load the full
  catalog into one prompt.
- Default agent attaches fourteen shipped skills, including candidate
  discovery, catalyst, market regime, price reaction, materiality, and risk
  assessment. The `whale-activity` slug is preserved and shown as large holder
  activity.
- Daily token budget defaults to 100000. Agents may set unlimited daily usage;
  analysis is then not skipped for a cap. Recorded usage and in-flight
  reservations still enforce finite caps, and evidence in the analysis prompt
  stays bounded.
- Discovery persists independent-evidence clusters as candidates without an
  LLM call. Reprints stay immaterial. Analysis still runs on material events
  only. A candidate is not a recommendation to buy, sell, or trade.
- A signal gate keeps weakly supported or interesting-but-immaterial results on
  the dashboard. Notification policy still decides delivery.
- Event and signal pages show which analysis dimensions ran and which were
  skipped for missing data.
- Watchlists page lists every agent watchlist. Overview and agent boards show
  eight named assets, then View more for the rest.

## 0.5.0

- X source: official recent search (`/2/tweets/search/recent`), encrypted bearer
  token, 7-day lookback, and plan/capability reporting. Archive search is not
  called.
- Evidence clustering by extracted assets and near-duplicate shingles. Derived
  reprints are not counted as independent sources. Crypto observations are
  extracted from source text.
- Telegram `disable_web_page_preview` and a single bounded 429 retry. WhatsApp
  Cloud API templates plus a 24-hour session window after inbound webhooks.
- Read-only portfolios of public addresses and operator-declared holdings.
  On-chain scanning is not implemented.
- Descending timestamp indexes on long-history list tables.

## 0.4.0

- Discord source: official bot HTTP polling, encrypted bot token, least-privilege
  invite (VIEW_CHANNEL and READ_MESSAGE_HISTORY), and MESSAGE_CONTENT intent
  checks. Lookback is recent channel messages, not archive search.

## 0.3.0

- User-created Crypto agents with schedule, daily token budget, attached
  skills, and a watchlist of canonical asset IDs.
- User markdown skills with privilege-grant rejection. Shipped skills cannot
  be overwritten or deleted.
- Scan windows follow each agent's schedule. Exhausted token budgets skip
  analysis and leave events `needs_analysis`.

## 0.2.0

- Session idle and absolute expiry, session cap, Settings session revoke,
  recovery remaining/rotate, security email, encryption key rotation with a
  previous master key, and paginated audit.
- Bounded-memory processing: page clamps, scan/analysis evidence caps,
  configurable worker concurrency, scheduler agent limit, RSS and peak RSS
  in health and performance tests.

## 0.1.0

- Local-first intelligence engine with an asset-class-agnostic core and a
  fully implemented Crypto domain.
- Four-step onboarding, encrypted secrets, SearXNG ingestion, staged LLM
  analysis, and a proof-first dashboard.
- Equities, Forex, Commodities, and Macro are represented as coming soon.
