import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const MAX_KEYS_FREE = 1;
const MAX_KEYS_PRO  = 10;

export async function apiKeyRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /user/api-keys
   * Generates a new API key. Returns the raw key ONCE — stored only as hash.
   */
  fastify.post(
    '/api-keys',
    { preHandler: fastify.authenticate },
    async (req: FastifyRequest<{ Body: { label?: string } }>, reply: FastifyReply) => {
      const userId  = BigInt(req.user.sub);
      const maxKeys = req.user.tier === 'pro' || req.user.tier === 'enterprise'
        ? MAX_KEYS_PRO
        : MAX_KEYS_FREE;

      const existingCount = await fastify.prisma.apiKey.count({
        where: { userId, isActive: true },
      });

      if (existingCount >= maxKeys) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: `Your plan allows a maximum of ${maxKeys} API key${maxKeys === 1 ? '' : 's'}.`,
        });
      }

      const rawKey  = `lc_${crypto.randomBytes(32).toString('base64url')}`;
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const label   = (req.body?.label as string | undefined)?.slice(0, 100) ?? null;

      await fastify.prisma.apiKey.create({ data: { userId, keyHash, label } });

      return reply.code(201).send({
        key:     rawKey,
        label,
        message: 'Save this key now — it will not be shown again.',
      });
    },
  );

  /**
   * GET /user/api-keys
   * Lists metadata only — never the raw key.
   */
  fastify.get(
    '/api-keys',
    { preHandler: fastify.authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = BigInt(req.user.sub);
      const keys = await fastify.prisma.apiKey.findMany({
        where: { userId, isActive: true },
        select: { id: true, label: true, lastUsedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send(
        keys.map((k) => ({
          id:         k.id.toString(),
          label:      k.label,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          createdAt:  k.createdAt.toISOString(),
        })),
      );
    },
  );

  /**
   * DELETE /user/api-keys/:id
   * Revokes immediately.
   */
  fastify.delete(
    '/api-keys/:id',
    { preHandler: fastify.authenticate },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = BigInt(req.user.sub);
      const keyId  = BigInt(req.params.id);

      const key = await fastify.prisma.apiKey.findUnique({ where: { id: keyId } });
      if (!key) return reply.code(404).send({ statusCode: 404, error: 'Not Found' });
      if (key.userId !== userId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden' });

      await fastify.prisma.apiKey.update({ where: { id: keyId }, data: { isActive: false } });
      return reply.code(204).send();
    },
  );
}
