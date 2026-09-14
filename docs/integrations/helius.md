# Helius

Helius is an **opt-in** evidence source for Solana enhanced TRANSFER webhooks.
Balance snapshots are not shipped.

Never paste a seed phrase or private key. The API key is stored encrypted.
Riddlr generates an auth header, stores it encrypted, and sends it to Helius
on create-webhook. Inbound POSTs must send that exact `Authorization` value
(not HMAC).

## Setup

Sources → **Add source** → **Configure Helius**. One source. Paste the Helius
API key. Riddlr calls `POST https://api.helius.xyz/v0/webhooks?api-key=` with
`webhookType: "enhanced"`, `transactionTypes: ["TRANSFER"]`, and
`webhookURL: <RIDDLR_PUBLIC_URL>/hooks/helius/<sourceId>`. Addresses are the
union of Solana `portfolio_wallets` and `labeled_addresses`, capped at 256.
Address updates use `PUT /v0/webhooks/{id}`.

`RIDDLR_ENV=test` skips the live create-webhook call. Caddy must proxy
`/hooks/*` to the API.

## Inbound

`POST /hooks/helius/:sourceId` compares `Authorization` to the stored header,
constant-time. Bodies over 1 MB are rejected. An empty JSON array is empty
success and does not insert a receipt. Transactions with `timestamp` older
than 10 minutes return `200 { ok: true, ignored: "stale" }`. Bad headers
return 401 and write `webhook.signature_mismatch`. Dedup key is
`(source_id, webhook_id, transaction signature)`. The HTTP handler enqueues
`riddlr.observe.poll` `{ kind: "inbound", receiptId, offset }`. Rate limit:
60 requests/min per source.

Verified 2026-09-14: enhanced webhook bodies are a JSON array of parsed
transactions. The documented TRANSFER example is `0.1 SOL`
(`100000000` lamports). Enhanced Transactions API is in maintenance; this
slice uses that webhook shape.

Official docs: https://www.helius.dev/docs/webhooks

| Item | Value |
| --- | --- |
| Adapter | `helius` |
| Family | `onchain` |
| Licence | Helius API terms; operator-local evidence only |
| Mapping | Native-complete on-chain transfer evidence; explorer URL is Solscan |

Impact and thresholds match [Alchemy](alchemy.md): $1M large-transfer floor,
$1,000 labeled floor, $10M exploit, SOL priced from `coingecko:solana`
`spot_price`.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `auth` | HTTP 401 from Helius | Rotate the API key |
| `rate_limited` | HTTP 429 | Wait |
| `unavailable` | 5xx, timeout, redirect, or HTML body | Check api.helius.xyz |
| `malformed` | Body is not an array, or a transaction is missing `signature` | Schema drift |

## Fixtures

Documented enhanced TRANSFER example captured 2026-09-14 from Helius docs.
See `packages/source-adapters/test/fixtures/README.md`.
