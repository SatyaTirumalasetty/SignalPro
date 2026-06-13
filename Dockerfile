FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY backend/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ── Build / source ────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY backend/src ./src
COPY backend/package.json ./

RUN addgroup -S signalpro && adduser -S signalpro -G signalpro
USER signalpro

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
