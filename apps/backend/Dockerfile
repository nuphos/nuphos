# syntax=docker/dockerfile:1.7

# --- deps: install production deps using the lockfile ----------------------
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY apps/backend/package.json apps/backend/bun.lock ./
COPY apps/backend/patches ./patches
RUN bun install --frozen-lockfile --production

# --- runtime: copy deps + source, run with bun -----------------------------
FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY apps/backend/package.json ./package.json
COPY apps/backend/tsconfig.json ./tsconfig.json
COPY apps/backend/src ./src
COPY apps/backend/scripts ./scripts

# Drop privileges. The oven/bun image ships with the `bun` user (uid 1000).
USER bun

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
