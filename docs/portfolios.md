# Portfolios

Portfolios are read-only books of **public wallet addresses** and
**operator-declared holdings**. Riddlr never asks for a seed phrase or private
key and never submits a transaction.

Holdings use canonical asset IDs (`coingecko:bitcoin`), not bare tickers.
Quantity is an operator-declared figure. It is not fetched from chain.

On-chain scanning is **not implemented**. An unknown `onchain` source adapter
records `capability_missing` and does not invent balances.

Events that mention the same canonical IDs as a portfolio's holdings are listed
on that portfolio as affected events.
