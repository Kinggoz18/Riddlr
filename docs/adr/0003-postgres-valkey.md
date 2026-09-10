# PostgreSQL as truth, Valkey as infrastructure

Durable state lives in PostgreSQL. Valkey (Redis protocol) holds BullMQ jobs,
locks, rate limits, and short caches. Operators may point `RIDDLR_REDIS_URL` at
Redis; Compose ships Valkey because its license fits an Apache-2.0 product.

Sessions, evidence, signals, and secrets never belong in Valkey.

**Status:** accepted
