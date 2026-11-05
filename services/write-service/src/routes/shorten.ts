import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { shortenRequestSchema } from '@link-click/validation';
import { RATE_LIMITS } from '@link-click/types';
import { ShortenService, ConflictError, UnsafeUrlError } from '../services/shorten.service';
import { SafeBrowsingClient } from '../lib/safe-browsing';
import { env } from '../lib/env';

export async function shortenRoutes(fastify: FastifyInstance): Promise<void> {
  const safeBrowsing = new SafeBrowsingClient(env.SAFE_BROWSING_API_KEY);
  const shortenService = new ShortenService(fastify.prisma, fastify.redis, safeBrowsing);

  /**
   * POST /shorten
   * Auth is optional — anonymous users get a lower rate limit.
   * See spec §5.2 and §7.5 for rate limit rules.
   */
  fastify.post(
    '/shorten',
    {
      preHandler: fastify.optionalAuth,
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      // Validate request body
      const parsed = shortenRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid request body',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      // Enforce rate limits based on auth tier
      const userId = req.user?.sub ? BigInt(req.user.sub) : undefined;
      const tier = req.user?.tier ?? 'anonymous';
      const rateLimitKey = userId ? `user:${userId.toString()}` : `ip:${req.ip}`;
      const limit = RATE_LIMITS[tier === 'anonymous' ? 'anonymous' : tier === 'pro' ? 'pro' : 'free'];

      const current = await fastify.redis.incr(`rl:shorten:${rateLimitKey}`);
      if (current === 1) {
        await fastify.redis.expire(`rl:shorten:${rateLimitKey}`, 3600);
      }
      if (current > limit) {
        return reply.code(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Maximum ${limit} shortens per hour for ${tier} tier.`,
          retryAfter: await fastify.redis.ttl(`rl:shorten:${rateLimitKey}`),
        });
      }

      try {
        const result = await shortenService.shorten({
          ...parsed.data,
          userId,
          baseUrl: env.SHORT_BASE_URL,
        });

        return reply.code(result.isNew ? 201 : 200).send(result);
      } catch (err) {
        if (err instanceof ConflictError) {
          return reply.code(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: err.message,
            details: { alternatives: err.alternatives },
          });
        }
        if (err instanceof UnsafeUrlError) {
          return reply.code(422).send({
            statusCode: 422,
            error: 'Unprocessable Entity',
            message: err.message,
            details: { threats: err.threats },
          });
        }
        fastify.log.error({ err }, 'Unexpected error in POST /shorten');
        return reply.code(500).send({ statusCode: 500, error: 'Internal Server Error' });
      }
    },
  );
}
