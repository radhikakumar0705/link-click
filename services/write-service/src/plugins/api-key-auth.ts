import crypto from 'crypto';
import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticateFlexible: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Adds `authenticateFlexible` — accepts either a standard JWT
 * or an API key (Bearer lc_... prefix).
 *
 * Routes that are extension-only (auth routes) keep using `authenticate`.
 * Routes that should also accept API key callers use `authenticateFlexible`.
 */
export const apiKeyAuthPlugin = fp(async (fastify: FastifyInstance) => {
  fastify.decorate(
    'authenticateFlexible',
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const authHeader = req.headers.authorization;

      if (authHeader?.startsWith('Bearer lc_')) {
        const raw = authHeader.slice('Bearer '.length);
        const keyHash = crypto.createHash('sha256').update(raw).digest('hex');

        const apiKey = await fastify.prisma.apiKey.findUnique({
          where: { keyHash },
          include: {
            user: { select: { id: true, email: true, tier: true, isActive: true } },
          },
        });

        if (!apiKey || !apiKey.isActive || !apiKey.user.isActive) {
          return reply.code(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Invalid or revoked API key',
          });
        }

        req.user = {
          sub:   apiKey.user.id.toString(),
          email: apiKey.user.email,
          tier:  apiKey.user.tier,
          iat: 0,
          exp: 0,
        };

        // Update lastUsedAt asynchronously — never block the request for this
        void fastify.prisma.apiKey
          .update({ where: { keyHash }, data: { lastUsedAt: new Date() } })
          .catch(() => { /* non-critical */ });

        return;
      }

      // Fall through to standard JWT validation
      return fastify.authenticate(req, reply);
    },
  );
});
