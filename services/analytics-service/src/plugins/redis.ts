import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { env } from '../lib/env';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

// Cache analytics summary responses to reduce DB load on popular links
export const ANALYTICS_CACHE_TTL = 300; // 5 minutes

export const AnalyticsKeys = {
  summary: (code: string, from: string, to: string) => `analytics:summary:${code}:${from}:${to}`,
  timeseries: (code: string, granularity: string, from: string, to: string) =>
    `analytics:ts:${code}:${granularity}:${from}:${to}`,
  exportQuota: (userId: string, code: string) =>
    `analytics:export:${userId}:${code}:${new Date().toISOString().slice(0, 10)}`,
} as const;

export const redisPlugin = fp(async (fastify: FastifyInstance) => {
  const redis = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });
  redis.on('error', (err) => fastify.log.error({ err }, 'Redis error'));
  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => redis.quit());
});
