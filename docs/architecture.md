# Architecture

Riddlr is a local-first intelligence engine. PostgreSQL is authoritative. Valkey
is ephemeral infrastructure. The LLM is a read-only analyst.

## Data path

```
Source → Evidence mention → Document (eligible web) → first-pass + understanding → Claims
  → Event (claim-aware cluster) → Reliability + domain impact
  → Analysis (material events) → Validated signal or unverified early warning
  → Dashboard / notification policy

ObservationProvider → observation_series → detectors → observation evidence → event
```

## Process split

- `apps/web` — Vite React dashboard with a side navigation and light/dark appearance.
  Overview is the morning view. Asset pages chart observation series with event
  markers. See [dashboard.md](dashboard.md) and
  [ADR 0030](adr/0030-dashboard-charting.md).
- `apps/server` `cmd/api` — Fastify HTTP
- `apps/server` `cmd/worker` — BullMQ processors
- `apps/server` `cmd/onboard` — host first-run (same four steps as the browser)
- `apps/server` `cmd/reset-password` — print a one-hour password-reset URL when
  email is not configured

The API does not run scans in-process.

## Bounded memory

List endpoints paginate. Scans cap sources and evidence. Analysis sends a
bounded evidence window. Worker concurrency and the scheduler agent set are
configurable with hard maxima. Scan windows follow each agent's schedule.
See [ADR 0013](adr/0013-bounded-memory.md),
[ADR 0014](adr/0014-agents-skills-watchlists.md),
[ADR 0015](adr/0015-discord-official-rest.md),
[ADR 0016](adr/0016-x-recent-search.md),
[ADR 0017](adr/0017-event-clustering.md),
[ADR 0018](adr/0018-whatsapp-cloud-api.md),
[ADR 0019](adr/0019-read-only-portfolios.md),
[ADR 0020](adr/0020-skill-composition.md),
[ADR 0021](adr/0021-discovery-candidates.md), and
[ADR 0022](adr/0022-first-run-access.md),
[ADR 0023](adr/0023-claim-corroboration.md), and
[ADR 0024](adr/0024-registry-driven-resolution.md), and
[ADR 0025](adr/0025-observation-layer.md), and
[ADR 0026](adr/0026-catalyst-taxonomy.md),
[ADR 0027](adr/0027-event-lifecycle-outcomes.md), and
[ADR 0028](adr/0028-typed-signal-policies.md), and
[ADR 0029](adr/0029-discord-webhook-delivery.md), and
[ADR 0030](adr/0030-dashboard-charting.md), and
[ADR 0031](adr/0031-equities-domain.md).

## Trust boundaries

Untrusted: browser, source content, LLM text, user skills, webhooks.
Semi-trusted: operator-configured endpoints (SearXNG, LLM base URL).
Trusted: Riddlr code, PostgreSQL, Valkey on the internal network, master key.

## Package direction

```
source-adapters, llm, notifications, queue  →  domain
domain-crypto, domain-equities  →  domain
apps/server  →  domain-crypto and domain-equities (composition root only)
packages/crypto  →  cryptography, never market logic
```

## Market domains

See [market-domains.md](market-domains.md). Crypto and Equities are supported.
Forex, Commodities, and Macro are coming soon.

## Agents

Operators create Crypto or Equities agents with a schedule, token budget (default 100000,
or unlimited), skills, and a watchlist. Coming-soon domains cannot execute. See
[agents-and-skills.md](agents-and-skills.md) and
[watchlists.md](watchlists.md).

Live sources are SearXNG (bundled; one `categories=news` query per watched
asset plus one general query), RSS/Atom feeds (operator-pasted URLs; more
than one feed is allowed), Discord (operator-configured invited bot; embeds,
threads, and 72h lookback; more than one Discord source is allowed), X
(operator-configured named-principal recent search with spend caps and bounded
`next_token`), opt-in DefiLlama observations (TVL, stablecoins, hacks), opt-in Hyperliquid and
Binance USD-M Futures perp observations, opt-in Polymarket and Kalshi prediction-market odds, opt-in Snapshot governance proposals, opt-in SEC EDGAR filings, opt-in Alchemy and Helius address-activity webhooks, and one active market-data source: CoinGecko,
CoinMarketCap, or Crypto.com Exchange public tickers. The CoinGecko registry
seed fills `assets` for watchlist search and text extraction. The observe worker
polls CoinGecko `/simple/price` into `observation_series` for watched, held, and
pinned assets. DefiLlama, when enabled, polls on a 15-minute interval. Hyperliquid
and Binance USD-M Futures, when enabled, poll on a 1-minute interval. Polymarket
and Kalshi, when enabled, poll on a 15-minute interval. Snapshot, when enabled,
polls once per scan (first 50 proposals after the stored `created` cursor). Opt-in
Alchemy and Helius inbound webhooks persist large transfers on labeled addresses
and portfolio wallets (`POST /hooks/alchemy/:sourceId` and
`POST /hooks/helius/:sourceId`; Caddy proxies `/hooks/*` to the API). Balance
snapshots are not shipped. Return-shock,
volume, TVL-drawdown, peg-deviation, market-stress, funding-divergence, and odds-jump detectors open material events with
reliability `observed` when a watched or pinned subject trips the threshold.
Events thread across scans by rolling-window identity (market domain, catalyst
kind, subject). Lifecycle, lead time, and +1h/+24h/+7d outcomes live on the
event. Scorecard is Overview-adjacent at `/scorecard`. Typed signals (exploit,
peg, unlock, listing, governance, regulatory, macro, perp stress) persist only
when the type's proof bar is met. Perp stress is a market observation.

Notifications claim a pending delivery row before any Telegram, WhatsApp, or
Discord incoming-webhook provider call. Discord execute uses `wait=true`.
Observation threshold alerts share that claim path and are never signals.
Public Caddy does not expose Mailpit or SearXNG.

## Failure

A failed source records an explicit source-run error and marks the scan partial.
It does not invent empty success. PostgreSQL down fails closed. Valkey down
pauses jobs; authenticated reads can continue.
