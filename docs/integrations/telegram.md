# Telegram Bot API — notification delivery

Telegram is a **notification channel**. It is not a source. Optional during
four-step onboarding and later under Settings → **Notifications** → Telegram.

## Setup

1. Create a bot with BotFather and copy the token.
2. Start a chat with the bot and copy the chat id.
3. Paste token and chat id on setup step 4 or Settings → Notifications.

The token is stored encrypted and never returned. There is no live `getMe`
probe on save.

## What Riddlr actually sends

| Call | Use |
| --- | --- |
| `POST https://api.telegram.org/bot<token>/sendMessage` | Signal, early warning, confirmation, dispute, retraction, observation alert |

Body: `chat_id`, `text` (split at 4,096 characters),
`link_preview_options.is_disabled`. Source text is escaped in application
templates. The LLM never writes the message.

Official docs: https://core.telegram.org/bots/api#sendmessage

| Item | Value |
| --- | --- |
| Channel | `telegram` |
| Licence | Telegram Bot API terms |
| Mapping | Delivery row claimed before the POST; retries of a `sent` claim are no-ops |

## Agent application

Defaults: high and critical to every configured target; moderate to the
primary target. Agent routing rules can replace those defaults. Confirmation,
dispute, and retraction follow the original destinations.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| HTTP 429 | Retries once when `retry_after` / `parameters.retry_after` is at most 5 seconds | Wait; raise cooldown if bursts hit the bot limit |
| Other non-2xx | Delivery row failed | Check the token and chat id |
| `below_threshold` / `cooldown` / `quiet_hours` | No send | Policy; not a Telegram error |

Deleted chats fail the POST. There is no in-app `auth` badge for Telegram
targets (Discord webhooks have that badge).

## Fixtures

No recorded `sendMessage` HTTP capture is in the tree. Unit tests cover
splitting at 4,096 characters and a single 429 retry when `retry_after` ≤ 5s.
