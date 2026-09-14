# Discord API v10 channel ingestion

Discord is an **opt-in** evidence source for invited-bot channel text. It is a
claim source only. Community channels attach mentions. Official-tier channels
can be primaries for listing, governance, and incident catalysts. Discord
never opens a quantitative event.

Incoming-webhook **delivery** is documented in
[discord-webhooks.md](discord-webhooks.md). This page is ingestion only.

## Setup

Sources → **Add source** → **Configure Discord**. Bot token, channel
snowflakes, optional word-boundary keywords, lookback 1–72 hours. Invite with
VIEW_CHANNEL | READ_MESSAGE_HISTORY (`66560`) and enable MESSAGE_CONTENT.

Set trust on the channel identity under Source identities. Authors without
their own policy inherit the parent channel's trust.

## What the adapter actually fetches

| Call | Use |
| --- | --- |
| `GET /channels/{channel.id}/messages?after=&limit=` | Channel messages, ≤5 pages, limit ≤100 |
| `GET /channels/{channel.id}/threads/archived/public?before=&limit=` | Public archived threads, ≤2 pages |
| `GET /channels/{thread.id}/messages?after=&limit=` | Thread starter page (1 page per thread, ≤16 threads) |

Text is `content` plus embed `title`, `description`, and `fields[].name/value`.
`attachments[]` stores `filename` and `content_type` only. Webhook embeds set
`referencedOriginKey` to `host:<embed url hostname>`. `reactions[].count` is
engagement context.

Verified 2026-09-14 against
https://discord.com/developers/docs/resources/message and
https://discord.com/developers/docs/resources/channel#list-public-archived-threads.
Documented message example id `334385199974967042`. Documented public thread
example id `41771983423143937`. HTTP 403 JSON `{ "message": "Missing Access", "code": 50001 }`.

Official docs: https://discord.com/developers/docs/resources/message

| Item | Value |
| --- | --- |
| Adapter | `discord` |
| Family | `discord` |
| Licence | Discord Developer Terms; invited bot only |
| Mapping | Native-complete when text or embeds are present; identity `{ platform: "discord", externalId: author_id, parentExternalId: channel_id }` |

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `blocked` | HTTP 403. Message names Missing Access (50001) or Missing Permissions (50013) | Re-invite with VIEW_CHANNEL and READ_MESSAGE_HISTORY |
| `capability_missing` | Empty content and empty embeds across the page | Enable MESSAGE_CONTENT (`1 << 15`) |
| `auth` | HTTP 401 | Replace the bot token |
| `rate_limited` | HTTP 429. Message includes `retry_after` when present | Wait; remaining pages for that channel stop |
| `unavailable` | 5xx | Retry on the next scan |
| `timeout` | Abort after 15s | Retry on the next scan |
| `malformed` | HTML 200, non-array messages, missing archived `threads` list, or a message missing `id` / `channel_id` | Schema drift |
| `too_large` | Body over 2 MB | Skip that call |

## Fixtures

Documented message, archived threads, Missing Access, empty, and drift
examples, 2026-09-14. See
`packages/source-adapters/test/fixtures/README.md`.
