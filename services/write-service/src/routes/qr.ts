import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import QRCode from 'qrcode';
import { env } from '../lib/env';

export async function qrRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /user/links/:code/qr
   *
   * Returns a QR code PNG for the short URL. Owner-only.
   * Cached in Redis for 24h — the QR content never changes for a given code.
   * Supports ?size=256 (pixels, 64–1024, default 256)
   */
  fastify.get(
    '/links/:code/qr',
    { preHandler: fastify.authenticateFlexible },
    async (
      req: FastifyRequest<{ Params: { code: string }; Querystring: { size?: string } }>,
      reply: FastifyReply,
    ) => {
      const { code } = req.params;
      const userId = BigInt(req.user.sub);

      const url = await fastify.prisma.url.findUnique({
        where: { shortCode: code },
        select: { userId: true, isActive: true },
      });

      if (!url) return reply.code(404).send({ statusCode: 404, error: 'Not Found' });
      if (url.userId !== userId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden' });
      if (!url.isActive) return reply.code(410).send({ statusCode: 410, error: 'Gone' });

      const rawSize = parseInt(req.query.size ?? '256', 10);
      const size = Math.min(1024, Math.max(64, Number.isNaN(rawSize) ? 256 : rawSize));

      const cacheKey = `qr:${code}:${size}`;
      const cached = await fastify.redis.getBuffer(cacheKey);
      if (cached) {
        return reply
          .header('Content-Type', 'image/png')
          .header('Cache-Control', 'public, max-age=86400')
          .header('X-Cache', 'HIT')
          .send(cached);
      }

      const shortUrl = `${env.SHORT_BASE_URL}/${code}`;
      const pngBuffer = await QRCode.toBuffer(shortUrl, {
        type: 'png',
        width: size,
        margin: 2,
        color: { dark: '#111827', light: '#FFFFFF' },
        errorCorrectionLevel: 'M',
      });

      await fastify.redis.set(cacheKey, pngBuffer, 'EX', 86400);

      return reply
        .header('Content-Type', 'image/png')
        .header('Cache-Control', 'public, max-age=86400')
        .header('Content-Disposition', `inline; filename="qr-${code}.png"`)
        .header('X-Cache', 'MISS')
        .send(pngBuffer);
    },
  );
}
