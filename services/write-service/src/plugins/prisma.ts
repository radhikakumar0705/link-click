import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const prismaPlugin = fp(async (fastify: FastifyInstance) => {
  const prisma = new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'error', emit: 'stdout' },
      { level: 'warn', emit: 'stdout' },
    ],
  });

  // Forward slow queries to the Fastify logger for observability
  prisma.$on('query', (e) => {
    if (e.duration > 100) {
      fastify.log.warn({ duration: e.duration, query: e.query }, 'Slow query detected');
    }
  });

  await prisma.$connect();
  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
