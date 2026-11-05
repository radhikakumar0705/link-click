FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY shared/types/package*.json ./shared/types/
COPY services/kafka-consumer/package*.json ./services/kafka-consumer/
COPY migrations/schema.prisma ./migrations/

RUN npm ci --workspace=@link-click/types \
           --workspace=@link-click/kafka-consumer

COPY shared/ ./shared/
COPY services/kafka-consumer/ ./services/kafka-consumer/
COPY tsconfig.base.json ./tsconfig.json ./

RUN npm run build -w @link-click/types \
 && npm run build -w @link-click/kafka-consumer

RUN npx prisma generate --schema=migrations/schema.prisma

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/shared/types/dist ./shared/types/dist
COPY --from=builder --chown=nodejs:nodejs /app/services/kafka-consumer/dist ./services/kafka-consumer/dist

USER nodejs

# No HTTP port — this is a long-running background process
CMD ["node", "services/kafka-consumer/dist/index.js"]
