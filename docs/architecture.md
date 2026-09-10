# Architecture

Riddlr is a local-first intelligence engine. PostgreSQL is authoritative. Valkey
is ephemeral infrastructure. The LLM is a read-only analyst.

## Data path

```
Source → Evidence → Entity / Asset / Instrument → Event
  → Market context (domain provider) → Analysis → Validated signal
  → Dashboard / notification policy
```

## Process split

- `apps/web` — Vite React dashboard
- `apps/server` `cmd/api` — Fastify HTTP
- `apps/server` `cmd/worker` — BullMQ processors

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
[ADR 0018](adr/0018-whatsapp-cloud-api.md), and
[ADR 0019](adr/0019-read-only-portfolios.md).

## Trust boundaries

Untrusted: browser, source content, LLM text, user skills, webhooks.
Semi-trusted: operator-configured endpoints (SearXNG, LLM base URL).
Trusted: Riddlr code, PostgreSQL, Valkey on the internal network, master key.

## Package direction

```
source-adapters, llm, notifications, queue  →  domain
domain-crypto  →  domain
apps/server  →  domain-crypto (composition root only)
packages/crypto  →  cryptography, never market logic
```

## Market domains

See [market-domains.md](market-domains.md). Crypto is supported. Equities,
Forex, Commodities, and Macro are coming soon.

## Agents

Operators create Crypto agents with a schedule, token budget, skills, and a
watchlist. Coming-soon domains cannot execute. See
[agents-and-skills.md](agents-and-skills.md) and
[watchlists.md](watchlists.md).

Live sources are SearXNG (bundled), Discord (operator-configured bot), X
(operator-configured recent search with bounded `next_token`), and CoinGecko
market data (optional operator key). On-chain scanning is not implemented.

Notifications claim a pending delivery row before any Telegram or WhatsApp
provider call. Public Caddy does not expose Mailpit or SearXNG.

## Failure

A failed source records an explicit source-run error and marks the scan partial.
It does not invent empty success. PostgreSQL down fails closed. Valkey down
pauses jobs; authenticated reads can continue.
