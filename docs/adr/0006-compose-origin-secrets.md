# Local secret generation and a single public origin

Compose publishes only `:8080`. PostgreSQL and Valkey stay on the internal
network. In development, empty `RIDDLR_COOKIE_SECRET` and
`RIDDLR_ENCRYPTION_MASTER_KEY` are generated into a volume and never logged.
Production must inject both.

**Status:** accepted
