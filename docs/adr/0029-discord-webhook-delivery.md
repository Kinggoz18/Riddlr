# Discord incoming webhook delivery

Signal, early-warning, confirmation, dispute, retraction, and observation
alerts are delivered over Telegram, WhatsApp Cloud API, and Discord incoming
webhooks. Discord uses an operator-pasted incoming webhook URL stored in
`encrypted_secrets`. Riddlr validates `GET /webhooks/{id}/{token}` (`type === 1`)
on save, shows only the channel id afterwards, and executes
`POST /webhooks/{id}/{token}?wait=true` with one embed and
`allowed_mentions.parse: []`. Observation threshold alerts use the same
channels and are labeled Observation; they never persist a signal.

**Status:** accepted
