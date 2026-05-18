# Single-stage build for apps/api in the pnpm monorepo.
# Simpler than multi-stage: avoids pnpm symlink relocation issues when copying
# node_modules across stages. Image is larger but reliable for a portfolio demo.

FROM node:20-slim

RUN corepack enable

WORKDIR /repo

# Copy manifests first for layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/types/package.json   packages/types/
COPY packages/tools/package.json   packages/tools/
COPY apps/api/package.json         apps/api/

RUN HUSKY=0 pnpm install --frozen-lockfile

# Copy source and build.
COPY packages/types   packages/types
COPY packages/tools   packages/tools
COPY apps/api         apps/api

RUN pnpm --filter @orbit-ctrl/types build
RUN pnpm --filter @orbit-ctrl/tools build
RUN pnpm --filter @orbit-ctrl/api  build

WORKDIR /repo/apps/api

ENV PORT=3001
EXPOSE 3001

CMD ["node", "dist/index.js"]
