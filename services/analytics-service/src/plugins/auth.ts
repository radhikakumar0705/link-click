import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { JwtPayload } from '@link-click/types';
import { env } from '../lib/env';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyJwt, {
    secret: { public: env.JWT_PUBLIC_KEY },
    verify: { algorithms: ['RS256'] },
  });

  fastify.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ statusCode: 401, error: 'Unauthorized' });
    }
  });

  fastify.decorate('optionalAuth', async (req: FastifyRequest) => {
    if (req.headers.authorization?.startsWith('Bearer ')) {
      try { await req.jwtVerify(); } catch { /* treat as anonymous */ }
    }
  });
});
