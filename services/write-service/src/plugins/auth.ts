import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { JwtPayload } from '@link-click/types';
import { env } from '../lib/env';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export const authPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyJwt, {
    secret: {
      private: env.JWT_PRIVATE_KEY,
      public: env.JWT_PUBLIC_KEY,
    },
    sign: { algorithm: 'RS256', expiresIn: env.JWT_ACCESS_TTL },
    verify: { algorithms: ['RS256'] },
  });

  /**
   * Strict auth — rejects the request if no valid JWT is present.
   * Use on all routes that require an authenticated user.
   */
  fastify.decorate(
    'authenticate',
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        await req.jwtVerify();
      } catch {
        await reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or missing token' });
      }
    },
  );

  /**
   * Optional auth — attaches user to request if a valid JWT is present,
   * but does not reject unauthenticated requests. Used on POST /shorten
   * which supports both anonymous and authenticated usage.
   */
  fastify.decorate(
    'optionalAuth',
    async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        try {
          await req.jwtVerify();
        } catch {
          // Silently ignore invalid tokens — treat as anonymous
        }
      }
    },
  );
});
