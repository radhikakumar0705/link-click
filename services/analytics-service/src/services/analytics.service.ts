import { PrismaClient } from '@prisma/client';
import { AnalyticsSummary, TimeseriesPoint, DeviceType } from '@link-click/types';

export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Returns a summary of clicks for a short link over a date range.
   * Reads from `click_hourly_summary` for speed; falls back to raw `clicks`
   * for very recent data that hasn't been aggregated yet (last ~1 hour).
   */
  async getSummary(
    shortCode: string,
    from: Date,
    to: Date,
  ): Promise<AnalyticsSummary> {
    const summaries = await this.prisma.clickHourlySummary.findMany({
      where: {
        shortCode,
        hourBucket: { gte: from, lte: to },
      },
      orderBy: { hourBucket: 'asc' },
    });

    // Aggregate across all hourly buckets
    let totalClicks = 0;
    let uniqueClicks = 0;
    const countryMap: Record<string, number> = {};
    const deviceMap: Record<string, number> = {};

    for (const row of summaries) {
      totalClicks += row.totalClicks;
      uniqueClicks += row.uniqueClicks;

      if (row.countryTop && typeof row.countryTop === 'object') {
        for (const [country, count] of Object.entries(row.countryTop as Record<string, number>)) {
          countryMap[country] = (countryMap[country] ?? 0) + count;
        }
      }

      if (row.deviceTop && typeof row.deviceTop === 'object') {
        for (const [device, count] of Object.entries(row.deviceTop as Record<string, number>)) {
          deviceMap[device] = (deviceMap[device] ?? 0) + count;
        }
      }
    }

    // Top-N slicing: return top 10 countries, all device types
    const topCountries = this.topN(countryMap, 10);
    const topDevices = deviceMap as Record<DeviceType, number>;

    // Referrers must come from raw clicks (not in hourly summaries yet in v1)
    const referrerRows = await this.prisma.$queryRaw<{ referrer_domain: string; count: bigint }[]>`
      SELECT referrer_domain, COUNT(*) as count
      FROM clicks
      WHERE short_code = ${shortCode}
        AND clicked_at >= ${from}
        AND clicked_at <= ${to}
        AND referrer_domain IS NOT NULL
      GROUP BY referrer_domain
      ORDER BY count DESC
      LIMIT 10
    `;

    const topReferrers: Record<string, number> = {};
    for (const row of referrerRows) {
      topReferrers[row.referrer_domain] = Number(row.count);
    }

    return {
      shortCode,
      totalClicks,
      uniqueClicks,
      topCountries,
      topDevices,
      topReferrers,
      periodStart: from.toISOString(),
      periodEnd: to.toISOString(),
    };
  }

  /**
   * Returns hourly or daily click timeseries for a short link.
   * Always reads from click_hourly_summary for efficiency.
   */
  async getTimeseries(
    shortCode: string,
    from: Date,
    to: Date,
    granularity: 'hour' | 'day',
  ): Promise<TimeseriesPoint[]> {
    if (granularity === 'hour') {
      const rows = await this.prisma.clickHourlySummary.findMany({
        where: { shortCode, hourBucket: { gte: from, lte: to } },
        orderBy: { hourBucket: 'asc' },
      });

      return rows.map((r) => ({
        bucket: r.hourBucket.toISOString(),
        totalClicks: r.totalClicks,
        uniqueClicks: r.uniqueClicks,
      }));
    }

    // Daily: group hour buckets by day in application code
    // (Avoids DATE_TRUNC cross-DB compatibility issues)
    const rows = await this.prisma.clickHourlySummary.findMany({
      where: { shortCode, hourBucket: { gte: from, lte: to } },
      orderBy: { hourBucket: 'asc' },
    });

    const dayMap = new Map<string, { total: number; unique: number }>();
    for (const row of rows) {
      const day = row.hourBucket.toISOString().slice(0, 10); // YYYY-MM-DD
      const existing = dayMap.get(day) ?? { total: 0, unique: 0 };
      dayMap.set(day, {
        total: existing.total + row.totalClicks,
        unique: existing.unique + row.uniqueClicks,
      });
    }

    return [...dayMap.entries()].map(([day, counts]) => ({
      bucket: day,
      totalClicks: counts.total,
      uniqueClicks: counts.unique,
    }));
  }

  /**
   * Export raw click data as CSV rows for Pro users.
   * Returns an async iterable to support streaming large exports.
   */
  async getRawClicksForExport(
    shortCode: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, unknown>[]> {
    // Limit export to 100k rows per request to prevent OOM
    const rows = await this.prisma.click.findMany({
      where: {
        shortCode,
        clickedAt: { gte: from, lte: to },
      },
      select: {
        clickedAt: true,
        country: true,
        city: true,
        deviceType: true,
        browser: true,
        os: true,
        referrerDomain: true,
        isUnique: true,
        // Explicitly exclude ip_hash — never export hashed IPs
      },
      orderBy: { clickedAt: 'desc' },
      take: 100_000,
    });

    return rows.map((r) => ({
      clicked_at: r.clickedAt.toISOString(),
      country: r.country ?? '',
      city: r.city ?? '',
      device_type: r.deviceType ?? '',
      browser: r.browser ?? '',
      os: r.os ?? '',
      referrer_domain: r.referrerDomain ?? '',
      is_unique: r.isUnique,
    }));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private topN(map: Record<string, number>, n: number): Record<string, number> {
    return Object.fromEntries(
      Object.entries(map)
        .sort(([, a], [, b]) => b - a)
        .slice(0, n),
    );
  }
}
