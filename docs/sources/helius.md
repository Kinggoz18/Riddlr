# Helius

Riddlr receives Helius enhanced TRANSFER webhooks only when you add the
source. It is an evidence source for large Solana transfers. Balance snapshots
are not shipped.

Sources → **Add source** → **Configure Helius**. API key required. Never paste
a seed phrase or private key. Caddy must proxy `/hooks/*` to the API.

See [integrations/helius.md](../integrations/helius.md).
