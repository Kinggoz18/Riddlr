# pnpm workspaces, Vite SPA, Fastify API

Riddlr is a long-running local-first system. A Next.js app would couple the
dashboard to SSR and fight a Fastify/BullMQ worker split. We use a pnpm
monorepo, a Vite React control plane, and a Fastify API with a separate worker
process from the same server package.

**Considered:** Next.js, npm workspaces, NestJS. Rejected: SSR/auth blur, extra
orchestrators, hidden plugin graphs.

**Status:** accepted
