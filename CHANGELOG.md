# Changelog

All notable changes to Riddlr are documented in this file.

## Unreleased

- Morning view (Overview), asset pages with observation charts, event lifecycle
  timelines, and a signal scorecard with precision and retraction rate. See
  [docs/dashboard.md](docs/dashboard.md) and
  [docs/adr/0030-dashboard-charting.md](docs/adr/0030-dashboard-charting.md).

- Discord incoming-webhook delivery, per-agent routing, and observation
  threshold alerts (labeled Observation, never signals). Telegram and WhatsApp
  remain. Settings → Notifications configures webhooks and alert rules; the
  agent page configures routing. See
  [docs/notifications.md](docs/notifications.md),
  [docs/integrations/discord-webhooks.md](docs/integrations/discord-webhooks.md),
  and [docs/adr/0029-discord-webhook-delivery.md](docs/adr/0029-discord-webhook-delivery.md).

- Eight typed signals persist only when their proof bar is met: exploit or
  bridge drain, stablecoin peg deviation, token unlock (always anticipated),
  listing or delisting, governance proposal, regulatory/legal/sanction, macro
  policy catalyst, and perp stress (market observation, never a fundamental
  signal). Signals shows the type. See
  [docs/signals.md](docs/signals.md) and
  [docs/adr/0028-typed-signal-policies.md](docs/adr/0028-typed-signal-policies.md).

- Event identity is a rolling window of market domain, catalyst kind, and
  subject instead of a UTC day. Lifecycle (`open`, `developing`, `confirmed`,
  `disputed`, `retracted`, `resolved`, `superseded`), lead time, and +1h/+24h/+7d
  price/funding/TVL outcomes are on the event. Scorecard is at Scorecard.
  See [docs/adr/0027-event-lifecycle-outcomes.md](docs/adr/0027-event-lifecycle-outcomes.md).

- X named-principal recent search: authors required (max 30),
  `-is:retweet -is:reply lang:en`, optional ANDed keywords, monthly read budget
  (default 5,000), `entities.urls[].expanded_url`. Discord ingest joins embeds,
  polls archived public threads (2 pages), stores reaction counts, and uses a
  72-hour lookback with 5 message pages per channel. Identity track records
  show later corroboration. Community social evidence cannot open events.
  See [docs/integrations/x.md](docs/integrations/x.md) and
  [docs/integrations/discord.md](docs/integrations/discord.md).

- Alchemy and Helius opt-in address-activity webhooks: inbound HMAC (Alchemy)
  and exact Authorization (Helius), labeled addresses, $1M large-transfer
  evidence. Balance snapshots are not shipped. Caddy proxies `/hooks/*` to the
  API. Sources → Add source → Configure Alchemy / Configure Helius. See
  [docs/integrations/alchemy.md](docs/integrations/alchemy.md) and
  [docs/integrations/helius.md](docs/integrations/helius.md).

- Snapshot opt-in governance evidence: GraphQL proposals from hub.snapshot.org,
  native-complete rows, official-firsthand space identities. Tally is not
  shipped. Sources → Add source → Configure Snapshot. See
  [docs/integrations/snapshot.md](docs/integrations/snapshot.md).

- Polymarket and Kalshi opt-in observation sources: YES odds, 1h/24h change, and
  an odds-jump detector (15 pp / 1h or 25 pp / 24h with a $10,000 liquidity
  floor). Always an early warning. Sources → Add source → Configure Polymarket /
  Configure Kalshi. See
  [docs/integrations/polymarket.md](docs/integrations/polymarket.md) and
  [docs/integrations/kalshi.md](docs/integrations/kalshi.md).

- Hyperliquid and Binance USD-M Futures opt-in observation sources: perpetual
  funding, open interest, mark price, and Binance liquidations. Market-stress
  and funding-divergence detectors. Sources → Add source → Configure
  Hyperliquid / Configure Binance USD-M Futures. See
  [docs/integrations/hyperliquid.md](docs/integrations/hyperliquid.md) and
  [docs/integrations/binance-futures.md](docs/integrations/binance-futures.md).

- DefiLlama opt-in observation source: protocol and chain TVL, stablecoin
  supply, secondary prices, and hourly hacks. TVL-drawdown and peg-deviation
  detectors. Sources → Add source → Configure DefiLlama. See
  [docs/integrations/defillama.md](docs/integrations/defillama.md).

- SearXNG runs one `categories=news` query per watched asset (cap 12) plus one
  domain-general query, dedupes hits by canonical URL, and blocks default
  price-tracker hosts from producing claims. Sources → SearXNG → Edit source
  sets an engine allowlist. See
  [docs/integrations/searxng.md](docs/integrations/searxng.md).

- RSS/Atom evidence adapter: operator-pasted feed URLs poll as snippets with
  SSRF, no DTD, ETag backoff, and trust set on the feed hostname. Sources →
  Add source → Configure RSS/Atom. See
  [docs/integrations/feeds.md](docs/integrations/feeds.md).

- Cross-domain catalyst taxonomy: full documents use regex as a first pass and
  cached LLM understanding as the primary claim extractor. Quantitative claims
  require value and unit. Signal `eventType` is a taxonomy kind. Events and
  Signals show the kind. See [docs/catalysts.md](docs/catalysts.md).

- Detector findings on a watched asset form a material event with reliability
  `observed` and no web article. The title is the detector claim. Per-event
  observations keep the series point the detector used. See
  [docs/observations.md](docs/observations.md).

- Observation series: the worker polls CoinGecko `/simple/price` for watched,
  held, and pinned assets on an interval independent of scans. Rows land in
  `observation_series` with retention and daily downsample. Return-shock and
  volume detectors emit observation evidence. Health shows poll freshness;
  watchlists show the last spot quote. See
  [docs/observations.md](docs/observations.md).

- Asset identity is the `assets` registry. Watchlist search and text extraction
  use CoinGecko’s top-N list (default 1,000) plus aliases and CAIP-19 contract
  ids. Bare tickers and unknown ids are rejected. See
  [docs/integrations/coingecko.md](docs/integrations/coingecko.md).

- Discord invite URLs include the Application ID (`client_id`). Discord returns
  Invalid Form Body without it. The Discord source form no longer uses a
  password-manager username/password pair for the bot token and server id.

- Settings → Security stores a Resend API key for password reset and security
  mail. Local Compose still uses Mailpit. Without email and without authenticator
  recovery codes, `cmd/reset-password` prints a one-hour reset URL.

- Settings shows the saved LLM provider, base URL, and model. The API key
  is still never returned.

- LLM base URLs accept the origin, a `/v1` path, or the full
  `/chat/completions` or `/messages` URL. Saving a model checks that it answers
  without requiring JSON Schema structured output.

- Events cluster on matching claim fingerprints or similar document text, not
  on “any bitcoin market-move today.” HTML extraction drops page chrome; search
  titles win over truncated page titles. Watchlist price quotes alone do not
  make a cluster material. CoinGecko snapshots absorbed into a news cluster are
  observations, not independent origins.

- Claim-level corroboration: search snippets stay mentions until eligible pages
  are enriched; reliability and impact are application-computed; signals
  prove claims to event-owned evidence. Notification eligibility follows impact,
  not model risk. Unverified early warnings are off unless enabled in
  notification policy. Shadow assessments persist reliability without sending
  notifications. New sources attach to the default agent or an explicit agent
  list, not every agent.

- OpenAI-compatible and Anthropic-compatible base URLs accept either the origin
  (`https://api.openai.com`) or a path that already ends in `/v1`
  (`https://openrouter.ai/api/v1`).

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
- The start script pulls published GHCR images (`:latest`, `linux/amd64` and
  `linux/arm64`) when they exist, otherwise it builds from the clone. Docker is
  still required.
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
