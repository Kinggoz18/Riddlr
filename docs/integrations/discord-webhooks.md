# Discord incoming webhooks — notification delivery

Discord incoming webhooks are a **notification channel**. They are not a
source. Channel ingestion is documented in
[discord.md](discord.md).

## Setup

1. In Discord: Channel settings → Integrations → Webhooks → New Webhook.
2. Copy the URL `https://discord.com/api/webhooks/{id}/{token}` (ptb, canary,
   and discordapp.com hosts are also accepted).
3. Settings → **Notifications** → **Discord webhook**. Paste the URL. Optional
   username and avatar URL. Optional primary target. Save.

Riddlr checks the URL shape, resolves the host through the SSRF allowlist,
then `GET`s the webhook and requires `type === 1`. The URL is stored encrypted
and never returned. The list shows the Discord `channel_id` and whether the
target is `ok` or `auth` (401/404, webhook deleted).

## Send

`POST /webhooks/{id}/{token}?wait=true` with JSON:

- `content` ≤ 2,000 characters
- one embed: title = reliability/kind prefix and headline; description = why
  it matters (≤ 1,000); fields = catalyst, impact, independent origins, source
  age, assets; url = the proof page; footer = agent name and `Riddlr 0.1.0`
- `allowed_mentions`: `{ "parse": [] }`
- optional operator `username` / `avatar_url`

Source text cannot inject `@everyone`, `@here`, or user mentions. A 400 embed
error falls back to `content` only. 401/404 mark the target `auth`. HTTP 429
honors `retry_after` (including fractional seconds) up to 5 seconds and two
retries. Per-webhook traffic is capped at 30 requests/minute; overflow and
queue overflow (`32` pending) are recorded as failed deliveries, never dropped
silently. High and critical still attempt send when the local minute budget is
exhausted so informational traffic cannot starve them.

Delivery claims a `pending` `notification_deliveries` row before the POST.
Retries are idempotent. Confirmation, dispute, and retraction reuse the
original destinations even when the original send failed.

## Routing

Defaults: high and critical to every configured target; moderate to the
primary target; early warnings only where Settings → Unverified early warnings
is on **and** the matching route includes them. An agent may replace defaults
with explicit rules (impact, catalyst kinds, assets, reliability, targets) on
the agent page. Two rules that name the same target deliver once.

## Observation alerts

Settings → **Notifications** → **Observation alerts** sets thresholds on
`spot_price`, `funding_rate_apr`, `tvl_usd`, or `odds_yes` (`gte`, `lte`,
`pct_drop`, `pct_move`). Messages are labeled **Observation** and are not
signals. Quiet hours and per-destination cooldown apply. Minimum risk does
not. Dedup is one delivery per rule, subject, UTC hour, and target.

## Fixtures

Live Execute Webhook capture was not available in this environment (no operator
webhook; outbound execute is blocked). Unit tests drive `GET`/`POST` at the
fetch seam with documented status codes: type-1 GET body, 429 `{ "retry_after":
1.5 }`, 404, and embed 400 fallback. That is the same seam Telegram uses.

Verified 2026-09-14 against
https://discord.com/developers/docs/resources/webhook#execute-webhook
and https://discord.com/developers/docs/resources/webhook#get-webhook.
URL shape from section 8.17 of the asset-intelligence plan.

Official docs: https://discord.com/developers/docs/resources/webhook
