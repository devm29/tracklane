# Build from the repository root: docker build -f apps/server/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/sync-core/package.json packages/sync-core/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter "@tracklane/server..."
COPY packages/domain packages/domain
COPY packages/sync-core packages/sync-core
COPY apps/server apps/server
RUN pnpm --filter @tracklane/domain build \
  && pnpm --filter @tracklane/server build \
  && pnpm --filter @tracklane/server deploy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8110
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8110/healthz || exit 1
CMD ["node", "dist/index.js"]
