FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY shared/types/package*.json ./shared/types/
COPY shared/validation/package*.json ./shared/validation/
COPY services/analytics-service/package*.json ./services/analytics-service/
COPY migrations/schema.prisma ./migrations/

RUN npm ci --workspace=@link-click/types \
           --workspace=@link-click/validation \
           --workspace=@link-click/analytics-service

COPY shared/ ./shared/
COPY services/analytics-service/ ./services/analytics-service/
COPY tsconfig.base.json ./tsconfig.json ./

RUN npm run build -w @link-click/types \
 && npm run build -w @link-click/validation \
 && npm run build -w @link-click/analytics-service

RUN npx prisma generate --schema=migrations/schema.prisma

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/shared/types/dist ./shared/types/dist
COPY --from=builder --chown=nodejs:nodejs /app/shared/validation/dist ./shared/validation/dist
COPY --from=builder --chown=nodejs:nodejs /app/services/analytics-service/dist ./services/analytics-service/dist

USER nodejs
EXPOSE 3003

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3003/health || exit 1

CMD ["node", "services/analytics-service/dist/index.js"]
