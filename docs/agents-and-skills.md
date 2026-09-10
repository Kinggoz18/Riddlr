# Agents and skills

The default agent is **Riddlr Intelligence Agent**, kind `system_default`,
domain `crypto`. Operators may create additional Crypto agents. Coming-soon
domains cannot create agents or start scans.

Each agent has:

- a schedule (`30m`, `1h`, `2h`, `4h`, `6h`, `12h`, `daily`)
- a daily token budget; when exhausted, analysis is skipped and the event stays
  `needs_analysis`
- attached markdown skills
- a watchlist of canonical asset IDs

The default agent cannot be deleted or renamed.

## Skills

Shipped skills live under `skills/crypto/` and load onto the default agent at
first-run. User skills are markdown stored in PostgreSQL.

Skills cannot add tools, filesystem access, or secret access. User skills cannot
override system policy. Shipped slugs cannot be overwritten or deleted.

Instruction hierarchy: system policy > agent policy > skill policy > source
content.
