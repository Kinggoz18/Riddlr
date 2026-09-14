# Discord

Riddlr polls Discord through the official HTTP API (`https://discord.com/api/v10`).
It does not scrape Discord and does not connect to the Gateway for ingestion.
X and Discord stay **claim sources only**. See
[integrations/discord.md](../integrations/discord.md).

## Bot setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Add a bot. Copy the bot token once. Riddlr stores it encrypted and never shows it again.
3. On the Bot page, enable the **Message Content Intent**. Channel text, embeds,
   attachments, components, and polls are empty without `MESSAGE_CONTENT` (`1 << 15`).
   Verified apps may also need privileged-intent approval. See
   [Gateway intents](https://docs.discord.com/developers/events/gateway) and
   [Message resource](https://docs.discord.com/developers/resources/message).
4. Invite the bot with **VIEW_CHANNEL** and **READ_MESSAGE_HISTORY** only.
   The permission integer is `66560`. Do not grant Administrator. The invite URL
   is
   `https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&permissions=66560&scope=bot`.
   Discord returns `Invalid Form Body` if `client_id` is missing. Sources →
   Configure Discord builds that link from the Application ID (Developer
   Portal → General Information) or from the bot token prefix.

Sources → **Add source** → **Configure Discord** accepts a server snowflake,
included and excluded channel IDs as chips, optional word-boundary keywords,
and a lookback of 1–72 hours. Add another Discord source for a second server.

Set trust on a Discord **channel** identity under Source identities to treat an
announcements channel as official. Authors without their own policy inherit
that channel's trust.

## What the adapter actually fetches

`GET /channels/{channel.id}/messages` returns at most 100 messages per request.
Riddlr sends `limit` ≤ 100 and `after` as a snowflake for the lookback window,
paginating at most 5 pages per channel. Archived public threads are listed
with `GET /channels/{channel.id}/threads/archived/public` (2 pages) and their
starter messages are polled. Missing `READ_MESSAGE_HISTORY` returns no
messages. This is not guild message-search archive access.

Text is `content` plus embed title, description, and fields. Attachment
metadata (filename, content type) is stored; files are not downloaded.
Webhook-authored embeds take `referencedOriginKey` from the embed URL host so
a bot reprint is not an independent origin. `reactions[].count` is stored as
engagement context.

Official reference: https://docs.discord.com/developers/resources/message
