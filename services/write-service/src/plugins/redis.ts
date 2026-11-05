import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { env } from '../lib/env';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

// Redis key namespaces — centralised to avoid scattered magic strings
export const RedisKeys = {
  /** Short-code → long-url mapping for the hot redirect path */
  url: (shortCode: string) => `url:${shortCode}`,

  /** Rate limit counter — keyed by user id or IP */
  rateLimit: (key: string) => `rl:${key}`,

  /** Refresh token blocklist (invalidated on logout) */
  tokenBlocklist: (jti: string) => `blocklist:${jti}`,

  /** Dedup lock — prevents duplicate inserts under race conditions */
  shortenLock: (hash: string) => `lock:shorten:${hash}`,
} as const;

export const REDIS_URL_TTL_SECONDS = 24 * 60 * 60; // 24 hours — pre-warm on write

export const redisPlugin = fp(async (fastify: FastifyInstance) => {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  redis.on('error', (err) => {
    fastify.log.error({ err }, 'Redis connection error');
  });

  redis.on('connect', () => {
    fastify.log.info('Redis connected');
  });

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
  });
});
