# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# --- Build ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Runtime (standalone output) ---
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
