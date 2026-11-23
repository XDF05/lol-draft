# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
# Keep dependency installation in a lockfile-only layer so application source
# changes do not invalidate it.
RUN npm ci --no-audit --no-fund

# --- Build ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
# Compose passes the browser-reachable URL; changing it requires a rebuild.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# --- Runtime (standalone output) ---
FROM base AS runner
ENV NODE_ENV=production
# Next standalone otherwise binds to the container hostname instead of all
# interfaces, making the in-container health check fail.
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Next.js may write image-optimization cache entries. That directory is the
# only application-owned writable path; all other runtime files stay
# root-owned and read-only to the application user.
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next/cache
EXPOSE 3000
USER node
CMD ["node", "server.js"]
