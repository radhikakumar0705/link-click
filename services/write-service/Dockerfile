# Multi-stage build — keeps the production image lean (~150MB vs ~800MB)

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace manifests first — maximises layer caching
COPY package*.json ./
COPY shared/types/package*.json ./shared/types/
COPY shared/base62/package*.json ./shared/base62/
COPY shared/validation/package*.json ./shared/validation/
COPY services/write-service/package*.json ./services/write-service/
COPY migrations/schema.prisma ./migrations/

RUN npm ci --workspace=@link-click/types \
           --workspace=@link-click/base62 \
           --workspace=@link-click/validation \
           --workspace=@link-click/write-service

# Copy source and build
COPY shared/ ./shared/
COPY services/write-service/ ./services/write-service/
COPY tsconfig.base.json ./tsconfig.json ./

RUN npm run build -w @link-click/types \
 && npm run build -w @link-click/base62 \
 && npm run build -w @link-click/validation \
 && npm run build -w @link-click/write-service

# Generate Prisma client for production
RUN npx prisma generate --schema=migrations/schema.prisma

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy only what's needed to run
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/shared/types/dist ./shared/types/dist
COPY --from=builder --chown=nodejs:nodejs /app/shared/base62/dist ./shared/base62/dist
COPY --from=builder --chown=nodejs:nodejs /app/shared/validation/dist ./shared/validation/dist
COPY --from=builder --chown=nodejs:nodejs /app/services/write-service/dist ./services/write-service/dist

USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "services/write-service/dist/index.js"]
