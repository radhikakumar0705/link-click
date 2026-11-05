FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY shared/types/package*.json ./shared/types/
COPY shared/base62/package*.json ./shared/base62/
COPY services/redirect-service/package*.json ./services/redirect-service/
COPY migrations/schema.prisma ./migrations/

RUN npm ci --workspace=@link-click/types \
           --workspace=@link-click/base62 \
           --workspace=@link-click/redirect-service

COPY shared/ ./shared/
COPY services/redirect-service/ ./services/redirect-service/
COPY tsconfig.base.json ./tsconfig.json ./

RUN npm run build -w @link-click/types \
 && npm run build -w @link-click/base62 \
 && npm run build -w @link-click/redirect-service

RUN npx prisma generate --schema=migrations/schema.prisma

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/shared/types/dist ./shared/types/dist
COPY --from=builder --chown=nodejs:nodejs /app/shared/base62/dist ./shared/base62/dist
COPY --from=builder --chown=nodejs:nodejs /app/services/redirect-service/dist ./services/redirect-service/dist

USER nodejs
EXPOSE 3002

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "services/redirect-service/dist/index.js"]
