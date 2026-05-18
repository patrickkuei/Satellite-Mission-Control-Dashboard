# Multi-stage build for apps/api in the pnpm monorepo.
# Place this file at the repo root so Docker can access workspace packages.

# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Enable corepack so the pnpm version in package.json is honoured.
RUN corepack enable

WORKDIR /repo

# Copy manifest files first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/types/package.json   packages/types/
COPY packages/tools/package.json   packages/tools/
COPY apps/api/package.json         apps/api/

RUN HUSKY=0 pnpm install --frozen-lockfile

# Copy source after deps are cached.
COPY packages/types   packages/types
COPY packages/tools   packages/tools
COPY apps/api         apps/api

# Build in dependency order.
RUN pnpm --filter @orbit-ctrl/types build
RUN pnpm --filter @orbit-ctrl/tools build
RUN pnpm --filter @orbit-ctrl/api  build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

# Copy compiled output and the node_modules that were already installed in the
# builder — avoids re-running pnpm install (and the husky prepare script).
COPY --from=builder /repo/node_modules           node_modules/
COPY --from=builder /repo/packages/types/dist    packages/types/dist/
COPY --from=builder /repo/packages/tools/dist    packages/tools/dist/
COPY --from=builder /repo/apps/api/dist          apps/api/dist/
COPY --from=builder /repo/apps/api/node_modules  apps/api/node_modules/

WORKDIR /app/apps/api

# SnapDeploy / generic container convention: $PORT is injected at runtime.
ENV PORT=3001
EXPOSE 3001

CMD ["node", "dist/index.js"]
