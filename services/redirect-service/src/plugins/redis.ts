import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { env } from '../lib/env';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export const redisPlugin = fp(async (fastify: FastifyInstance) => {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  redis.on('error', (err) => fastify.log.error({ err }, 'Redis error'));
  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => redis.quit());
});
