# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/source-adapters/package.json packages/source-adapters/package.json
COPY packages/llm/package.json packages/llm/package.json
COPY packages/notifications/package.json packages/notifications/package.json
COPY packages/domain-crypto/package.json packages/domain-crypto/package.json
COPY packages/domain-equities/package.json packages/domain-equities/package.json
COPY packages/testkit/package.json packages/testkit/package.json
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @riddlr/web... build

FROM nginx:1.27-alpine
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
