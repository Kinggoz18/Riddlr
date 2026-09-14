# Portfolios

Portfolios are read-only books of **public wallet addresses** and
**operator-declared holdings**. Riddlr never asks for a seed phrase or private
key and never submits a transaction.

Holdings use canonical asset IDs (`coingecko:bitcoin`) underneath named
assets in the dashboard. Quantity is an operator-declared figure. It is not
fetched from chain.

When CoinGecko, CoinMarketCap, or Crypto.com Exchange is the active market-data
source, the portfolio list and detail screens show USD marks, 24h change, and
weights. Only one market-data source is enabled at a time.

On-chain **balance snapshots are not shipped**. Opt-in Alchemy and Helius
address-activity webhooks persist large transfers on public portfolio wallets
and labeled addresses. An unknown `onchain` adapter is not registered.

Events that mention the same canonical IDs as a portfolio's holdings are listed
on that portfolio as affected events.
