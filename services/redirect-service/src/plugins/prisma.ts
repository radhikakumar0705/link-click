import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const prismaPlugin = fp(async (fastify: FastifyInstance) => {
  const prisma = new PrismaClient({ log: ['error', 'warn'] });
  await prisma.$connect();
  fastify.decorate('prisma', prisma);
  fastify.addHook('onClose', async () => prisma.$disconnect());
});
