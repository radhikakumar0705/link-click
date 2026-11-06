import cron from 'node-cron';
import { FastifyInstance } from 'fastify';

/**
 * Aggregation Jobs
 *
 * Runs two scheduled tasks:
 *   1. Every 5 minutes: aggregate last 2 hours of raw clicks into hourly summaries.
 *      (Overlapping window ensures we catch any late-arriving Kafka events.)
 *   2. Daily at 02:00 UTC: expire stale links and create next month's partition.
 *
 * In v2 these should be extracted into a dedicated container so they don't
 * compete with API request handling for CPU/memory.
 */
export function registerAggregationJobs(fastify: FastifyInstance): void {
  // ── Job 1: Rolling hourly aggregation ───────────────────────────────────────
  cron.schedule('*/5 * * * *', () => {
    void runHourlyAggregation(fastify);
  });

  // ── Job 2: Daily maintenance ─────────────────────────────────────────────────
  cron.schedule('0 2 * * *', () => {
    void runDailyMaintenance(fastify);
  });

  fastify.log.info('Aggregation jobs registered (*/5 min, daily 02:00 UTC)');
}

/**
 * Upserts click_hourly_summary rows for the last 2 hours.
 *
 * Uses a raw SQL upsert for performance — this runs every 5 minutes
 * and must be fast even at 1B clicks/day scale.
 */
async function runHourlyAggregation(fastify: FastifyInstance): Promise<void> {
  const windowStart = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago

  try {
    // One query: aggregate clicks → upsert into summary table
    // The JSONB aggregation builds the country/device breakdown in Postgres,
    // avoiding shipping thousands of rows to the application layer.
    await fastify.prisma.$executeRaw`
      INSERT INTO click_hourly_summary (
        short_code,
        hour_bucket,
        total_clicks,
        unique_clicks,
        country_top,
        device_top
      )
      SELECT
        short_code,
        DATE_TRUNC('hour', clicked_at) AS hour_bucket,
        COUNT(*)                        AS total_clicks,
        COUNT(*) FILTER (WHERE is_unique) AS unique_clicks,
        JSONB_OBJECT_AGG(country, country_count)
          FILTER (WHERE country IS NOT NULL) AS country_top,
        JSONB_OBJECT_AGG(device_type, device_count)
          FILTER (WHERE device_type IS NOT NULL) AS device_top
      FROM (
        SELECT
          short_code,
          clicked_at,
          is_unique,
          country,
          device_type,
          COUNT(*) OVER (PARTITION BY short_code, DATE_TRUNC('hour', clicked_at), country)     AS country_count,
          COUNT(*) OVER (PARTITION BY short_code, DATE_TRUNC('hour', clicked_at), device_type) AS device_count
        FROM clicks
        WHERE clicked_at >= ${windowStart}
      ) sub
      GROUP BY short_code, DATE_TRUNC('hour', clicked_at)
      ON CONFLICT (short_code, hour_bucket) DO UPDATE SET
        total_clicks  = EXCLUDED.total_clicks,
        unique_clicks = EXCLUDED.unique_clicks,
        country_top   = EXCLUDED.country_top,
        device_top    = EXCLUDED.device_top
    `;

    fastify.log.debug('Hourly aggregation completed');
  } catch (err) {
    // Log and continue — a missed aggregation is not fatal; the next run will catch up
    fastify.log.error({ err }, 'Hourly aggregation job failed');
  }
}

/**
 * Daily maintenance tasks:
 * - Deactivate links past their expiry date
 * - Create the next month's clicks partition (so it exists before the month starts)
 * - Archive old click rows to S3 (stub — implement with AWS SDK in v1.1)
 */
async function runDailyMaintenance(fastify: FastifyInstance): Promise<void> {
  fastify.log.info('Running daily maintenance');

  try {
    // Deactivate expired links
    const expired = await fastify.prisma.url.updateMany({
      where: {
        expiresAt: { lt: new Date() },
        isActive: true,
      },
      data: { isActive: false },
    });
    fastify.log.info({ count: expired.count }, 'Expired links deactivated');

    // Create next month's clicks partition — only if clicks is actually partitioned.
    // In v1 it's a plain table (see migrations/schema.prisma), and CREATE ... PARTITION OF
    // a plain table fails, which used to make this job error every night.
    const [{ partitioned }] = await fastify.prisma.$queryRaw<[{ partitioned: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid
        WHERE c.relname = 'clicks' AND c.relnamespace = 'public'::regnamespace
      ) AS partitioned
    `;
    if (!partitioned) {
      fastify.log.info('clicks is not partitioned; skipping partition creation');
      return;
    }

    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const partitionStart = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1);
    const partitionEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 1);
    const partitionName = `clicks_${partitionStart.toISOString().slice(0, 7).replace('-', '_')}`;

    await fastify.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF clicks
        FOR VALUES FROM ('${partitionStart.toISOString()}') TO ('${partitionEnd.toISOString()}')
    `);

    fastify.log.info({ partitionName }, 'Ensured next month clicks partition exists');
  } catch (err) {
    fastify.log.error({ err }, 'Daily maintenance job failed');
  }
}
