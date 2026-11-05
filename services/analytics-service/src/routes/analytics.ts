import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { analyticsQuerySchema } from '@link-click/validation';
import { AnalyticsService } from '../services/analytics.service';
import { AnalyticsKeys, ANALYTICS_CACHE_TTL } from '../plugins/redis';
import { env } from '../lib/env';

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  const svc = new AnalyticsService(fastify.prisma);

  // ── Shared helpers ──────────────────────────────────────────────────────────

  /**
   * Resolves and validates the date range based on the user's tier.
   * Free users are limited to 7 days of history; Pro gets 90 days.
   */
  function resolveDateRange(
    fromStr: string | undefined,
    toStr: string | undefined,
    tier: string,
  ): { from: Date; to: Date } | { error: string } {
    const to = toStr ? new Date(toStr) : new Date();
    const maxDays =
      tier === 'pro' || tier === 'enterprise'
        ? env.PRO_TIER_ANALYTICS_DAYS
        : env.FREE_TIER_ANALYTICS_DAYS;

    const earliestAllowed = new Date();
    earliestAllowed.setDate(earliestAllowed.getDate() - maxDays);

    const from = fromStr ? new Date(fromStr) : earliestAllowed;

    if (from < earliestAllowed) {
      return {
        error: `Your plan allows up to ${maxDays} days of analytics history. Upgrade to Pro for 90 days.`,
      };
    }

    if (from >= to) {
      return { error: '`from` must be before `to`' };
    }

    return { from, to };
  }

  async function assertOwnership(
    shortCode: string,
    userId: bigint,
  ): Promise<boolean> {
    const url = await fastify.prisma.url.findUnique({
      where: { shortCode },
      select: { userId: true },
    });
    return url?.userId === userId;
  }

  // ── GET /analytics/:code ────────────────────────────────────────────────────

  fastify.get(
    '/:code',
    { preHandler: fastify.authenticate },
    async (
      req: FastifyRequest<{ Params: { code: string }; Querystring: Record<string, string> }>,
      reply: FastifyReply,
    ) => {
      const { code } = req.params;
      const userId = BigInt(req.user.sub);

      if (!(await assertOwnership(code, userId))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden' });
      }

      const query = analyticsQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', details: query.error.flatten() });
      }

      const range = resolveDateRange(query.data.from, query.data.to, req.user.tier);
      if ('error' in range) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: range.error });
      }

      // Try cache first
      const cacheKey = AnalyticsKeys.summary(code, range.from.toISOString(), range.to.toISOString());
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.header('X-Cache', 'HIT').send(JSON.parse(cached) as unknown);
      }

      const summary = await svc.getSummary(code, range.from, range.to);
      await fastify.redis.set(cacheKey, JSON.stringify(summary), 'EX', ANALYTICS_CACHE_TTL);

      return reply.header('X-Cache', 'MISS').send(summary);
    },
  );

  // ── GET /analytics/:code/timeseries ─────────────────────────────────────────

  fastify.get(
    '/:code/timeseries',
    { preHandler: fastify.authenticate },
    async (
      req: FastifyRequest<{ Params: { code: string }; Querystring: Record<string, string> }>,
      reply: FastifyReply,
    ) => {
      const { code } = req.params;
      const userId = BigInt(req.user.sub);

      if (!(await assertOwnership(code, userId))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden' });
      }

      const query = analyticsQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request' });
      }

      const range = resolveDateRange(query.data.from, query.data.to, req.user.tier);
      if ('error' in range) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: range.error });
      }

      const cacheKey = AnalyticsKeys.timeseries(
        code, query.data.granularity, range.from.toISOString(), range.to.toISOString(),
      );
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.header('X-Cache', 'HIT').send(JSON.parse(cached) as unknown);
      }

      const points = await svc.getTimeseries(code, range.from, range.to, query.data.granularity);
      await fastify.redis.set(cacheKey, JSON.stringify(points), 'EX', ANALYTICS_CACHE_TTL);

      return reply.send(points);
    },
  );

  // ── GET /analytics/:code/export ─────────────────────────────────────────────

  fastify.get(
    '/:code/export',
    { preHandler: fastify.authenticate },
    async (
      req: FastifyRequest<{ Params: { code: string }; Querystring: Record<string, string> }>,
      reply: FastifyReply,
    ) => {
      // Pro-only feature
      if (req.user.tier !== 'pro' && req.user.tier !== 'enterprise') {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'CSV export is available on the Pro plan.',
        });
      }

      const { code } = req.params;
      const userId = BigInt(req.user.sub);

      if (!(await assertOwnership(code, userId))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden' });
      }

      // Rate limit: 1 export per link per day per user
      const quotaKey = AnalyticsKeys.exportQuota(userId.toString(), code);
      const used = await fastify.redis.incr(quotaKey);
      if (used === 1) await fastify.redis.expire(quotaKey, 86400);
      if (used > 1) {
        return reply.code(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Export limit: 1 per link per day.',
        });
      }

      const query = analyticsQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request' });
      }

      const range = resolveDateRange(query.data.from, query.data.to, req.user.tier);
      if ('error' in range) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: range.error });
      }

      const rows = await svc.getRawClicksForExport(code, range.from, range.to);

      // Build CSV manually — avoids json2csv async issues in Fastify reply chain
      const headers = ['clicked_at', 'country', 'city', 'device_type', 'browser', 'os', 'referrer_domain', 'is_unique'];
      const csv = [
        headers.join(','),
        ...rows.map((r) =>
          headers.map((h) => JSON.stringify(r[h] ?? '')).join(',')
        ),
      ].join('\n');

      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="link-click-${code}-export.csv"`)
        .send(csv);
    },
  );
}
