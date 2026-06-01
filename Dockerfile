# Multi-stage Dockerfile for Bunker Team Game
# Stage 1 (builder): installs all deps and builds all packages
# Stage 2 (production): copies only built artifacts — no dev deps, no source

# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9 --quiet

# Copy workspace configuration files
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./

# Copy package manifests for all workspaces (for dependency resolution)
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/client/package.json ./packages/client/package.json

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
COPY packages/client ./packages/client
COPY content ./content

# Build in dependency order: shared → server → client
RUN pnpm --filter @bunker/shared build && \
    pnpm --filter @bunker/server build && \
    pnpm --filter @bunker/client build

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Install pnpm for prod dep install
RUN npm install -g pnpm@9 --quiet

# Copy workspace config for pnpm to understand the workspace structure
COPY package.json pnpm-workspace.yaml ./
COPY packages/server/package.json ./packages/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json

# Copy built artifacts
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/client/dist ./packages/client/dist

# Copy content files (also mounted as volume — this provides defaults)
COPY --from=builder /app/content ./content

# Install only production dependencies
RUN pnpm install --prod --filter @bunker/server

# The server reads the React dist/ from a relative path
# packages/server/dist/index.js → ../../client/dist (via __dirname navigation)
# This path is set correctly in ContentData.ts and the static file plugin

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "packages/server/dist/index.js"]
