# Drizzle and SQL migrations

Evidence clustering, provenance joins, and JSONB metadata need SQL-shaped
queries. Drizzle keeps the schema in TypeScript and emits reviewable SQL
migrations. Prisma hides SQL; Kysely has no first-class migrator.

JSONB is allowed only for adapter extras, capability snapshots, and redacted
traces — never as the home for users, sessions, agents, or signals.

**Status:** accepted
