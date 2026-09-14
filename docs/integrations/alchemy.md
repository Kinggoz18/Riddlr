# Alchemy

Alchemy is an **opt-in** evidence source for EVM address-activity webhooks.
Balance snapshots are not shipped.

Never paste a seed phrase or private key. The Notify token is stored
encrypted. The webhook signing key returned by create-webhook is stored
encrypted and is never shown again.

## Setup

Sources → **Add source** → **Configure Alchemy**. One source. Paste the
Alchemy Notify auth token (`X-Alchemy-Token`). Riddlr calls
`POST https://dashboard.alchemy.com/api/create-webhook` with
`webhook_type: "ADDRESS_ACTIVITY"` and
`webhook_url: <RIDDLR_PUBLIC_URL>/hooks/alchemy/<sourceId>`. Addresses are
the union of Ethereum `portfolio_wallets` and `labeled_addresses`, capped at
256. Address updates use `PATCH /api/update-webhook-addresses`.

`RIDDLR_ENV=test` skips the live create-webhook call. Caddy must proxy
`/hooks/*` to the API; otherwise inbound POSTs hit the SPA.

Health is `GET /api/team-webhooks`. `is_active: false` is treated as
`capability_missing`.

## Inbound

`POST /hooks/alchemy/:sourceId` verifies `X-Alchemy-Signature` as hex
HMAC-SHA256 of the raw body (no `sha256=` prefix), constant-time. Bodies over
1 MB are rejected. Events with `createdAt` older than 10 minutes return
`200 { ok: true, ignored: "stale" }`. Bad signatures return 401 and write
`webhook.signature_mismatch`. Dedup key is
`(source_id, webhook_id, event_id)`. The HTTP handler enqueues
`riddlr.observe.poll` `{ kind: "inbound", receiptId, offset }` and does not
process transfers. Rate limit: 60 requests/min per source.

## Evidence

Native-complete `sourceFamily: "onchain"`. Canonical URL is the Etherscan
transaction. `externalId` is `txHash:logIndex`. Transfers at or above $1M USD
emit `crypto:large_transfer`. Stables (USDC, USDT, DAI, USD, USDP, TUSD) treat
`value` as USD. ETH/WETH use the latest `spot_price` for `coingecko:ethereum`.
Per-token floor $1,000. Exploit threshold $10M. Portfolio-owned transfers
persist even below $1M, without a large-transfer claim. Reason codes:
`exchange_inflow`, `treasury_outflow`, `bridge_outflow`. Exchange inflow
alone is impact **low**. Bridge/treasury outflow or exploit is **high**. Other
large transfers are **moderate**. On-chain evidence does not emit
`crypto:security_incident`.

Verified 2026-09-14: the official ADDRESS_ACTIVITY example has **two**
activity items (USDC `293.092129` and `2400`), not three. Both are below $1M.

Official docs: https://www.alchemy.com/docs/reference/address-activity-webhook

| Item | Value |
| --- | --- |
| Adapter | `alchemy` |
| Family | `onchain` |
| Licence | Alchemy API terms; operator-local evidence only |
| Mapping | Native-complete on-chain transfer evidence |

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `auth` | HTTP 401 from Notify | Rotate the Notify token |
| `capability_missing` | Webhook missing or `is_active: false` | Re-enable in Alchemy or re-save the source |
| `rate_limited` | HTTP 429 | Wait; Riddlr caps Notify at the HTTP class |
| `unavailable` | 5xx, timeout, redirect, or HTML body | Check dashboard.alchemy.com |
| `malformed` | Missing `webhookId` / `id` / `activity` | Schema drift |

An empty `activity` list is empty success. A replay after HTTP 200 is
deduped. An address that is no longer watched is still parsed; it is stored
only if it is portfolio-owned, labeled at/above the $1,000 floor, or at/above
$1M. Payloads with more than 64 activity items are processed in offset pages
of 64; none are dropped.

## Fixtures

Documented ADDRESS_ACTIVITY example captured 2026-09-14 from Alchemy docs.
See `packages/source-adapters/test/fixtures/README.md`.
