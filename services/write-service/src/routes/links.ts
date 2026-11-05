import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { paginationSchema } from '@link-click/validation';

export async function linksRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /user/links
   * Returns a paginated list of the authenticated user's short links.
   */
  fastify.get(
    '/links',
    { preHandler: fastify.authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = paginationSchema.safeParse(req.query);
      if (!query.success) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request' });
      }

      const { page, limit, tag } = query.data;
      const userId = BigInt(req.user.sub);
      const skip = (page - 1) * limit;

      const where = {
        userId,
        isActive: true,
        ...(tag ? { tags: { some: { tag } } } : {}),
      };

      const [urls, total] = await Promise.all([
        fastify.prisma.url.findMany({
          where,
          include: { tags: { select: { tag: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        fastify.prisma.url.count({ where }),
      ]);

      const baseUrl = process.env.SHORT_BASE_URL ?? 'https://snplink.io';

      return reply.send({
        data: urls.map((u) => ({
          shortCode: u.shortCode,
          shortUrl: `${baseUrl}/${u.shortCode}`,
          longUrl: u.longUrl,
          clickCount: u.clickCount,
          isActive: u.isActive,
          isCustom: u.isCustom,
          expiresAt: u.expiresAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
          tags: u.tags.map((t) => t.tag),
        })),
        page,
        limit,
        total,
        hasNextPage: skip + limit < total,
      });
    },
  );

  /**
   * DELETE /user/links/:code
   * Soft-deletes (deactivates) a link. Only the owner can delete.
   */
  fastify.delete(
    '/links/:code',
    { preHandler: fastify.authenticate },
    async (
      req: FastifyRequest<{ Params: { code: string } }>,
      reply: FastifyReply,
    ) => {
      const { code } = req.params;
      const userId = BigInt(req.user.sub);

      const url = await fastify.prisma.url.findUnique({ where: { shortCode: code } });
      if (!url) return reply.code(404).send({ statusCode: 404, error: 'Not Found' });
      if (url.userId !== userId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden' });

      await fastify.prisma.url.update({ where: { shortCode: code }, data: { isActive: false } });

      // Invalidate the Redis cache entry immediately
      await fastify.redis.del(`url:${code}`);

      return reply.code(204).send();
    },
  );
}
