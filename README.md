# Riddlr

Riddlr is a **local-first intelligence engine**. It monitors configured sources,
collects evidence, correlates independent proof, and produces schema-validated
read-only signals.

The **core is asset-class agnostic**. The currently **supported** market domain
is **Crypto**. Equities, Forex, Commodities, and Macro are **planned / coming
soon** and cannot execute scans.

Riddlr is not a tracker, not a trading bot, and not an AI wrapper around a news
feed. It never trades, never signs, and never asks for private keys.

## Quick start

```bash
git clone https://github.com/Kinggoz18/Riddlr.git
cd Riddlr
./scripts/riddlr-up.sh
```

Open http://127.0.0.1:8080 in a browser on the same machine and complete setup
(four steps). If Docker is missing, the start script can install or start it
after you confirm. Pre-built images skip building from source; they do not
replace Docker.

```bash
curl -fsSL https://raw.githubusercontent.com/Kinggoz18/Riddlr/main/scripts/install.sh | bash
```

That downloads `scripts/install.sh` from GitHub, which then clones the
repository into `~/riddlr` and starts Riddlr. Windows: `scripts/riddlr-up.ps1`
after a clone, or `scripts/install.ps1`. See [Install](docs/install.md).

No `.env` file is required for local Compose. Encryption material is generated
into a named volume on first boot. Those defaults are for local use, not a
public internet deployment.

On a remote server, run the same start command, then the SSH command it prints,
and open http://127.0.0.1:8080 on the machine with the browser. To let other
devices open the URL without SSH, start with `--public` / `-Public`. Unused
setup codes expire after 15 minutes. See [Install](docs/install.md).

## What you get after setup

- An administrator account with TOTP 2FA and recovery codes
- An encrypted LLM provider configuration
- Bundled SearXNG search as the first live source
- Optional Discord bot source (official HTTP API; more than one Discord source is allowed)
- Optional X recent-search source (official API, plan-gated)
- One active market-data source at a time: CoinGecko, CoinMarketCap, or Crypto.com Exchange public tickers
- Read-only portfolios of public addresses and declared holdings
- The default **Riddlr Intelligence Agent**, the first-run Crypto watcher
- Additional Crypto agents, markdown skills, and canonical-ID watchlists
- Overview, Signals, Events, Agents, Sources, Watchlists, Notifications, Portfolios, Scan History, AI Usage, and System Health
- Side navigation with light or dark appearance (dark is the default)

## Architecture in one paragraph

PostgreSQL is the source of truth. Valkey is infrastructure (queues, locks,
rate limits, short-lived cache). Fastify serves the API. A separate worker
process runs BullMQ jobs. The dashboard is a Vite/React control plane. Domain
implementations register at the application edge; generic packages never import
Crypto-specific code.

See [docs/architecture.md](docs/architecture.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Install](docs/install.md)
- [Onboarding](docs/onboarding.md)
- [Authentication](docs/auth.md)
- [Secret storage](docs/secret-storage.md)
- [Market domains](docs/market-domains.md)
- [LLM providers](docs/llm-providers.md)
- [SearXNG](docs/sources/searxng.md)
- [RSS/Atom](docs/sources/feeds.md)
- [DefiLlama](docs/sources/defillama.md)
- [Hyperliquid](docs/sources/hyperliquid.md)
- [Binance USD-M Futures](docs/sources/binance-futures.md)
- [Polymarket](docs/sources/polymarket.md)
- [Kalshi](docs/sources/kalshi.md)
- [Snapshot](docs/sources/snapshot.md)
- [Alchemy](docs/sources/alchemy.md)
- [Helius](docs/sources/helius.md)
- [Discord](docs/sources/discord.md)
- [X](docs/sources/x.md)
- [CoinGecko](docs/sources/coingecko.md)
- [CoinMarketCap](docs/sources/coinmarketcap.md)
- [Crypto.com Exchange](docs/sources/cryptocom.md)
- [Agents and skills](docs/agents-and-skills.md)
- [Watchlists](docs/watchlists.md)
- [Portfolios](docs/portfolios.md)
- [Notifications](docs/notifications.md)
- [Development](docs/development.md)
- [Testing](docs/testing.md)
- [Release](docs/release.md)
- [Security](SECURITY.md)

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
