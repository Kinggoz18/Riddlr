# Alchemy

Riddlr receives Alchemy ADDRESS_ACTIVITY webhooks only when you add the
source. It is an evidence source for large EVM transfers. Balance snapshots
are not shipped. Tally is not shipped.

Sources → **Add source** → **Configure Alchemy**. Notify token required.
Never paste a seed phrase or private key. Caddy must proxy `/hooks/*` to the
API.

See [integrations/alchemy.md](../integrations/alchemy.md).
