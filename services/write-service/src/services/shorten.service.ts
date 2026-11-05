import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { encode } from '@link-click/base62';
import { ShortenRequestInput } from '@link-click/validation';
import { ShortenResponse } from '@link-click/types';
import { RedisKeys, REDIS_URL_TTL_SECONDS } from '../plugins/redis';
import { SafeBrowsingClient, describeThreat } from '../lib/safe-browsing';

const BCRYPT_ROUNDS = 10;
const LOCK_TTL_MS = 5000;

interface ShortenOptions extends ShortenRequestInput {
  userId?: bigint;
  baseUrl: string;
}

export class ShortenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly safeBrowsing: SafeBrowsingClient,
  ) {}

  async shorten(opts: ShortenOptions): Promise<ShortenResponse> {
    const { longUrl, customAlias, expiresAt, password, maxClicks, tags, userId, baseUrl } = opts;

    const normalised = this.normaliseUrl(longUrl);
    const longUrlHash = this.sha256(normalised);

    // ── Safety check ──────────────────────────────────────────────────────────
    const safety = await this.safeBrowsing.check(normalised);
    if (!safety.isSafe) {
      const firstThreat = safety.threats[0];
      throw new UnsafeUrlError(
        describeThreat(firstThreat.threatType),
        safety.threats.map((t) => t.threatType),
      );
    }

    // ── Per-user dedup ────────────────────────────────────────────────────────
    if (userId) {
      const existing = await this.prisma.url.findFirst({
        where: { longUrlHash, userId, isActive: true },
        include: { tags: true },
      });
      if (existing) {
        return this.buildResponse(existing.shortCode, normalised, false, existing.expiresAt, baseUrl);
      }
    }

    // ── Dedup lock ────────────────────────────────────────────────────────────
    const lockKey = RedisKeys.shortenLock(longUrlHash + (userId?.toString() ?? 'anon'));
    const lockAcquired = await this.redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX');

    let passwordHash: string | null = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    }

    // ── Custom alias path ─────────────────────────────────────────────────────
    if (customAlias) {
      const taken = await this.prisma.url.findUnique({ where: { shortCode: customAlias } });
      if (taken) {
        if (lockAcquired) await this.redis.del(lockKey);
        throw new ConflictError(
          `Alias '${customAlias}' is already taken`,
          await this.suggestAlternatives(customAlias),
        );
      }

      const url = await this.createUrl({
        shortCode: customAlias,
        longUrl: normalised,
        longUrlHash,
        userId,
        isCustom: true,
        passwordHash,
        maxClicks,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        tags,
      });

      if (lockAcquired) await this.redis.del(lockKey);
      await this.prewarmCache(url.shortCode, normalised);
      return this.buildResponse(url.shortCode, normalised, true, url.expiresAt, baseUrl);
    }

    // ── Auto-generated code path ──────────────────────────────────────────────
    // FIX: Pull the next sequence value BEFORE inserting so we can encode it
    // to Base62 and write the real shortCode in a single INSERT — no race
    // condition, no 'tmp' placeholder, no second UPDATE round-trip.
    const seqResult = await this.prisma.$queryRaw<[{ nextval: bigint }]>`
      SELECT nextval(pg_get_serial_sequence('urls', 'id')) AS nextval
    `;
    const nextId = seqResult[0].nextval;
    const shortCode = encode(nextId);

    const url = await this.prisma.url.create({
      data: {
        id: nextId,
        shortCode,
        longUrl: normalised,
        longUrlHash,
        userId,
        isCustom: false,
        passwordHash,
        maxClicks,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        tags: tags?.length ? { create: tags.map((tag) => ({ tag })) } : undefined,
      },
    });

    if (lockAcquired) await this.redis.del(lockKey);
    await this.prewarmCache(shortCode, normalised);
    return this.buildResponse(shortCode, normalised, true, url.expiresAt, baseUrl);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async createUrl(data: {
    shortCode: string;
    longUrl: string;
    longUrlHash: string;
    userId?: bigint;
    isCustom: boolean;
    passwordHash: string | null;
    maxClicks?: number;
    expiresAt: Date | null;
    tags?: string[];
  }) {
    return this.prisma.url.create({
      data: {
        shortCode: data.shortCode,
        longUrl: data.longUrl,
        longUrlHash: data.longUrlHash,
        userId: data.userId,
        isCustom: data.isCustom,
        passwordHash: data.passwordHash,
        maxClicks: data.maxClicks,
        expiresAt: data.expiresAt,
        tags: data.tags?.length
          ? { create: data.tags.map((tag) => ({ tag })) }
          : undefined,
      },
    });
  }

  private async prewarmCache(shortCode: string, longUrl: string): Promise<void> {
    await this.redis.set(RedisKeys.url(shortCode), longUrl, 'EX', REDIS_URL_TTL_SECONDS);
  }

  private normaliseUrl(url: string): string {
    const parsed = new URL(url);
    const tracking = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid'];
    tracking.forEach((p) => parsed.searchParams.delete(p));
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  private sha256(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  private buildResponse(
    shortCode: string,
    longUrl: string,
    isNew: boolean,
    expiresAt: Date | null,
    baseUrl: string,
  ): ShortenResponse {
    return {
      shortUrl: `${baseUrl}/${shortCode}`,
      shortCode,
      longUrl,
      isNew,
      expiresAt: expiresAt?.toISOString() ?? null,
    };
  }

  private async suggestAlternatives(alias: string): Promise<string[]> {
    const candidates = [
      `${alias}-1`,
      `${alias}-${Math.floor(Math.random() * 900) + 100}`,
      `${alias}_link`,
    ];
    const available: string[] = [];
    for (const c of candidates) {
      const exists = await this.prisma.url.findUnique({ where: { shortCode: c } });
      if (!exists) available.push(c);
      if (available.length === 3) break;
    }
    return available;
  }
}

export class ConflictError extends Error {
  constructor(message: string, public readonly alternatives: string[]) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class UnsafeUrlError extends Error {
  constructor(message: string, public readonly threats: string[]) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}
