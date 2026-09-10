# Notifications

Validated signals are delivered according to instance notification policy
(minimum risk, cooldown, optional quiet hours). Cooldown is scoped to each
channel destination. Delivery claims a `pending` row before any provider call.
Retries of a `sent` claim are no-ops.

## Telegram

Optional during four-step onboarding and configurable later under Settings.
`sendMessage` uses `link_preview_options.is_disabled`. HTTP 429 retries once
when `retry_after` is at most 5 seconds.

## WhatsApp Cloud API

Official Graph API only (`POST https://graph.facebook.com/v22.0/{phone-number-id}/messages`
by default; Graph version is configurable). No unofficial WhatsApp clients.

Configure under Settings → **WhatsApp Cloud API**: access token, **App Secret**,
phone-number id, destination, approved template name and language, and a
webhook verify token. Secrets are stored encrypted and never returned.

- `POST /api/v1/webhooks/whatsapp` requires `X-Hub-Signature-256` HMAC-SHA256
  of the raw body. Missing or invalid signatures return 403.
- GET subscription verification remains a separate verify-token check.
- Inbound timestamps must be authentic Unix seconds within a 15-minute future
  skew and a 7-day max age. Replay of Meta message IDs is ignored.
- Session text is sent only when an inbound message from that destination
  arrived in the last 24 hours.
- Otherwise Riddlr sends the configured approved template.

Webhook URL: `GET`/`POST` `/api/v1/webhooks/whatsapp`.
