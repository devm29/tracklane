# Build from the repository root: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:8110
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/sync-core/package.json packages/sync-core/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@tracklane/web..."
COPY packages/domain packages/domain
COPY packages/sync-core packages/sync-core
COPY apps/web apps/web
RUN pnpm --filter @tracklane/domain build \
  && pnpm --filter @tracklane/sync-core build \
  && pnpm --filter @tracklane/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3110 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3110
CMD ["node", "apps/web/server.js"]
