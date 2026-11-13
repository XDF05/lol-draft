# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# --- Build (compile TypeScript, then prune dev dependencies) ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Runtime ---
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/main.js"]
