# Adopted skills

Each skill is recorded with provenance. We did not bulk-install the ecosystem.

| Skill | Source | Provides | When | Affects | Constraints |
| --- | --- | --- | --- | --- | --- |
| domain-modeling | mattpocock/skills | CONTEXT.md + short ADRs | changing language | glossary, docs/adr | no implementation in CONTEXT |
| tdd | mattpocock/skills | red-green at public seams | new behavior | tests | no tautologies |
| create-rule | Cursor | `.mdc` format | agent OS | `.cursor/rules` | process only |
| frontend-design | anthropics/skills | distinctive UI discipline | dashboard | `apps/web`, `packages/ui` | bound to navy/mint |
| web-design-guidelines | vercel-labs | a11y/design audit | UI review | dashboard | ignore Next/RSC |
| playwright-best-practices | Checkly / Microsoft | locators, storageState | e2e | `tests/` | no networkidle waits |

Rejected: Prisma, Next.js, scrape, landing-page, Cloudflare Workers, video,
low-install Fastify/BullMQ skills. Fastify and BullMQ rules are written from
this repository's architecture and official docs.
