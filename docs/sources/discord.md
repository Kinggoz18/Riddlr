# Discord

Riddlr polls Discord through the official HTTP API (`https://discord.com/api/v10`).
It does not scrape Discord and does not connect to the Gateway for ingestion.

## Bot setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Add a bot. Copy the bot token once. Riddlr stores it encrypted and never shows it again.
3. On the Bot page, enable the **Message Content Intent**. Channel text, embeds,
   attachments, components, and polls are empty without `MESSAGE_CONTENT` (`1 << 15`).
   Verified apps may also need privileged-intent approval. See
   [Gateway intents](https://docs.discord.com/developers/events/gateway) and
   [Message resource](https://docs.discord.com/developers/resources/message).
4. Invite the bot with **VIEW_CHANNEL** and **READ_MESSAGE_HISTORY** only.
   The permission integer is `66560`. Do not grant Administrator.

Sources → **Add source** → **Configure Discord** accepts a server snowflake,
included and excluded channel IDs as chips, optional keywords, and a lookback
of 1–24 hours. Add another Discord source for a second server.

## What the adapter actually fetches

`GET /channels/{channel.id}/messages` returns at most 100 messages per request
(newest first). Riddlr sends `limit` ≤ 50 and `after` as a snowflake for the
lookback window. Missing `READ_MESSAGE_HISTORY` returns no messages. This is
not guild message-search archive access.

Official reference: https://docs.discord.com/developers/resources/message
