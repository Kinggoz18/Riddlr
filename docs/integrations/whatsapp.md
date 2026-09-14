# WhatsApp Cloud API — notification delivery

WhatsApp Cloud API is a **notification channel**. It is not a source. Official
Graph API only. No unofficial WhatsApp clients.

## Setup

Settings → **Notifications** → WhatsApp Cloud API: access token, App Secret,
phone-number id, destination, approved template name and language, webhook
verify token. Secrets are stored encrypted and never returned.

Webhook URL: `GET`/`POST` `/api/v1/webhooks/whatsapp`.

Graph base default is `https://graph.facebook.com/v22.0`. The Graph version is
configurable. Plan text that names v20 is stale; the product uses v22.0.

## What Riddlr actually sends

| Call | Use |
| --- | --- |
| `POST https://graph.facebook.com/v22.0/{phone-number-id}/messages` | Session `type: text` inside the 24-hour window; otherwise the approved template |

Session text ≤ 4,096 characters. Template body parameter ≤ 1,024 characters.
Inbound `POST /api/v1/webhooks/whatsapp` requires `X-Hub-Signature-256`
HMAC-SHA256 of the raw body with the App Secret. Missing or invalid signatures
return 403. GET subscription verification uses the verify token. Inbound Unix
timestamps must fall within 15 minutes future skew and 7 days max age. Replay
of Meta message ids is ignored. At most 20 inbound messages are read from one
payload.

Official docs: https://developers.facebook.com/docs/whatsapp/cloud-api

| Item | Value |
| --- | --- |
| Channel | `whatsapp` |
| Licence | Meta Cloud API terms |
| Mapping | Delivery row claimed before the POST |

When the customer-service window is closed, Riddlr sends the configured
approved template. Re-approve the template in Meta Business Manager if the
body fields change.

## Agent application

Same routing as Telegram and Discord webhooks. Observation alerts are labeled
Observation and are never signals.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| 403 on inbound | Signature mismatch | Check App Secret; raw body HMAC |
| Window closed | Session send refused | Inbound message from that destination, or use the template |
| HTTP non-2xx on send | Delivery row failed | Token, phone-number id, template name |
| Stale or future timestamp | Inbound ignored | Clock; payload `timestamp` is Unix seconds |

## Fixtures

No recorded Graph execute capture is in the tree. Unit tests cover the 24-hour
session window, timestamp skew, HMAC verification, and inbound parse bounds.
