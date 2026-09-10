# Changelog

All notable changes to Riddlr are documented in this file.

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
