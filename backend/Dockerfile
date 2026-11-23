# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
# The lockfile-only layer is reused until dependencies change, so source-only
# edits do not reinstall node_modules.
RUN npm ci --no-audit --no-fund

# --- Build (compile TypeScript, then prune dev dependencies) ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY tsconfig.json ./tsconfig.json
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build && npm prune --omit=dev

# --- Migration runner (one-shot Compose service) ---
# Keeps the Prisma CLI and dev dependencies out of the runtime image while
# still applying the checked-in migrations before the API starts.
FROM base AS migrator
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY prisma.config.ts ./prisma.config.ts
COPY prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]

# --- Runtime ---
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
EXPOSE 4000
# Runtime files stay root-owned and read-only to the application user.
USER node
CMD ["node", "dist/main.js"]
