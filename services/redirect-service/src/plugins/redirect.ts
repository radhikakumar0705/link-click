import crypto from 'crypto';
import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { UAParser } from 'ua-parser-js';
import { isValidShortCode } from '@link-click/base62';
import { ClickEvent, DeviceType } from '@link-click/types';
import { env } from '../lib/env';

const CACHE_MAX_TTL_SECONDS = 24 * 60 * 60;
const PASSWORD_MAX_ATTEMPTS = 10;
const PASSWORD_WINDOW_SECONDS = 15 * 60;
const UNIQUE_WINDOW_SECONDS = 48 * 60 * 60; // > 1 day so late events still dedupe

type Link = {
  longUrl: string;
  expiresAt: Date | null;
  passwordHash: string | null;
  maxClicks: number | null;
  clickCount: number;
};

/**
 * Cache hits are redirected with no further checks, so only links that need
 * none are cacheable: no password, no click limit. The entry never outlives
 * the link's expiry. Returns 0 for "don't cache".
 * Keep in sync with prewarmCache() in write-service/src/services/shorten.service.ts.
 */
function cacheTtlSeconds(link: Link): number {
  if (link.passwordHash || link.maxClicks !== null) return 0;
  if (!link.expiresAt) return CACHE_MAX_TTL_SECONDS;
  return Math.max(0, Math.min(CACHE_MAX_TTL_SECONDS, Math.floor((link.expiresAt.getTime() - Date.now()) / 1000)));
}

export const redirectPlugin = fp(async (fastify: FastifyInstance) => {
  // The password form posts application/x-www-form-urlencoded.
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 2048 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  /** Looks up an active, unexpired link, or sends the 404/410 page and returns null. */
  async function loadLink(code: string, reply: FastifyReply): Promise<Link | null> {
    const url = await fastify.prisma.url.findUnique({
      where: { shortCode: code },
      select: { longUrl: true, expiresAt: true, isActive: true, passwordHash: true, maxClicks: true, clickCount: true },
    });
    if (!url) {
      void reply.code(404).type('text/html').send(notFoundPage(code));
      return null;
    }
    if (!url.isActive) {
      // Deleted links are 404; links switched off by their click limit stay 410.
      const limitReached = url.maxClicks !== null && (await clicksUsed(code, url)) >= url.maxClicks;
      void (limitReached
        ? reply.code(410).type('text/html').send(expiredPage())
        : reply.code(404).type('text/html').send(notFoundPage(code)));
      return null;
    }
    if (url.expiresAt && url.expiresAt < new Date()) {
      void reply.code(410).type('text/html').send(expiredPage());
      return null;
    }
    if (url.maxClicks !== null && (await clicksUsed(code, url)) >= url.maxClicks) {
      void deactivate(code);
      void reply.code(410).type('text/html').send(expiredPage());
      return null;
    }
    return url;
  }

  // ── Click limits ─────────────────────────────────────────────────────────────
  // click_count in Postgres lags (Kafka batch), so limits are enforced with an
  // atomic Redis counter, seeded from Postgres the first time it's needed.
  async function seedCounter(code: string, link: Link): Promise<string> {
    const key = `maxclicks:${code}`;
    const ttl = link.expiresAt ? Math.max(60, Math.floor((link.expiresAt.getTime() - Date.now()) / 1000)) : 90 * 86400;
    await fastify.redis.set(key, String(link.clickCount), 'EX', ttl, 'NX');
    return key;
  }
  async function clicksUsed(code: string, link: Link): Promise<number> {
    return Number(await fastify.redis.get(await seedCounter(code, link)));
  }
  /** Atomically claims one click. False if the limit is already reached. */
  async function claimClick(code: string, link: Link): Promise<boolean> {
    const n = await fastify.redis.incr(await seedCounter(code, link));
    return n <= (link.maxClicks as number);
  }
  async function deactivate(code: string): Promise<void> {
    await fastify.prisma.url.update({ where: { shortCode: code }, data: { isActive: false } }).catch(() => undefined);
    await fastify.redis.del(`url:${code}`);
  }

  /** Final step for every successful visit: enforce the click limit, cache, count, redirect. */
  async function follow(req: FastifyRequest, reply: FastifyReply, code: string, link: Link): Promise<FastifyReply> {
    if (link.maxClicks !== null && !(await claimClick(code, link))) {
      void deactivate(code);
      return reply.code(410).type('text/html').send(expiredPage());
    }
    const ttl = cacheTtlSeconds(link);
    if (ttl > 0) await fastify.redis.set(`url:${code}`, link.longUrl, 'EX', ttl);
    void emitClickEvent(fastify, req, code);
    // no-store: every visit must reach us so it's counted and checked (see ADR-002).
    return reply.header('Cache-Control', 'no-store').redirect(302, link.longUrl);
  }

  /**
   * GET /:code — the hot path (spec §3.4)
   * 1. Validate the code format (no DB access for junk)
   * 2. Redis hit → redirect (only check-free links are ever cached)
   * 3. Miss → Postgres: active / expiry / click limit
   * 4. Password links → show the form (submitted via POST below)
   * 5. Cache if allowed, publish ClickEvent (fire-and-forget), 302
   */
  fastify.get('/:code', async (req: FastifyRequest<{ Params: { code: string } }>, reply: FastifyReply) => {
    const { code } = req.params;
    if (!isValidShortCode(code)) {
      return reply.code(404).type('text/html').send(notFoundPage(code));
    }

    const cached = await fastify.redis.get(`url:${code}`);
    if (cached) {
      void emitClickEvent(fastify, req, code);
      return reply.header('Cache-Control', 'no-store').redirect(302, cached);
    }

    const link = await loadLink(code, reply);
    if (!link) return reply;

    if (link.passwordHash) {
      return reply.code(200).header('Cache-Control', 'no-store').type('text/html').send(passwordPage(code, null));
    }
    return follow(req, reply, code, link);
  });

  /**
   * POST /:code — password form submission. The password travels in the request
   * body (never the URL, so it stays out of history and access logs), and each
   * visitor gets PASSWORD_MAX_ATTEMPTS tries per PASSWORD_WINDOW_SECONDS.
   */
  fastify.post(
    '/:code',
    async (req: FastifyRequest<{ Params: { code: string }; Body: { pwd?: string } | undefined }>, reply: FastifyReply) => {
      const { code } = req.params;
      if (!isValidShortCode(code)) {
        return reply.code(404).type('text/html').send(notFoundPage(code));
      }
      const link = await loadLink(code, reply);
      if (!link) return reply;
      if (!link.passwordHash) return follow(req, reply, code, link);

      const attemptsKey = `pwdfail:${code}:${hashIp(req.ip)}`;
      const attempts = Number(await fastify.redis.get(attemptsKey));
      if (attempts >= PASSWORD_MAX_ATTEMPTS) {
        return reply.code(429).type('text/html').send(passwordPage(code, 'Too many attempts. Try again in 15 minutes.'));
      }

      const bcrypt = await import('bcrypt');
      const submitted = req.body?.pwd ?? '';
      if (!submitted || !(await bcrypt.compare(submitted, link.passwordHash))) {
        const n = await fastify.redis.incr(attemptsKey);
        if (n === 1) await fastify.redis.expire(attemptsKey, PASSWORD_WINDOW_SECONDS);
        return reply.code(401).type('text/html').send(passwordPage(code, 'Incorrect password — please try again.'));
      }

      await fastify.redis.del(attemptsKey);
      return follow(req, reply, code, link);
    },
  );
});

// ── IP hashing (ADR-006) ───────────────────────────────────────────────────────
// hash = HMAC(dayKey, ip), dayKey = HMAC(IP_HASH_SECRET, UTC date).
// - Secret: without the key, hashes can't be reversed by hashing every IPv4 address.
// - Daily: the key changes at UTC midnight, so the same visitor can't be linked across days.
// The date is read per request, so rotation doesn't depend on process restarts.
let dayKeyCache = { day: '', key: Buffer.alloc(0) };
function hashIp(ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  if (dayKeyCache.day !== day) {
    dayKeyCache = { day, key: crypto.createHmac('sha256', env.IP_HASH_SECRET).update(`ip-day-key:${day}`).digest() };
  }
  return crypto.createHmac('sha256', dayKeyCache.key).update(ip).digest('hex');
}

// ── Click event emission ───────────────────────────────────────────────────────

async function emitClickEvent(
  fastify: FastifyInstance,
  req: FastifyRequest,
  shortCode: string,
): Promise<void> {
  try {
    const ua = new UAParser(req.headers['user-agent'] ?? '');
    const ipHash = hashIp(req.ip);
    // Unique = first visit from this visitor to this link today. SET NX is atomic,
    // so this holds across consumer batches and redirect-service instances.
    const isUnique =
      (await fastify.redis.set(`uniq:${shortCode}:${ipHash}`, '1', 'EX', UNIQUE_WINDOW_SECONDS, 'NX')) === 'OK';

    const event: ClickEvent = {
      shortCode,
      clickedAt:      new Date().toISOString(),
      ipHash,
      userAgent:      req.headers['user-agent'] ?? '',
      country:        null,
      city:           null,
      deviceType:     resolveDeviceType(ua),
      browser:        ua.getBrowser().name ?? null,
      os:             ua.getOS().name ?? null,
      referrer:       req.headers.referer ?? null,
      referrerDomain: extractDomain(req.headers.referer),
      isUnique,
    };

    await fastify.publishClick(event);
  } catch (err) {
    fastify.log.warn({ err, shortCode }, 'Failed to emit click event');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function resolveDeviceType(ua: UAParser): DeviceType {
  const device = ua.getDevice();
  if (device.type === 'mobile') return 'mobile';
  if (device.type === 'tablet') return 'tablet';
  const raw = ua.getUA().toLowerCase();
  if (['bot', 'crawler', 'spider', 'scraper', 'slurp', 'lighthouse'].some((s) => raw.includes(s))) {
    return 'bot';
  }
  return 'desktop';
}

function extractDomain(referer: string | undefined): string | null {
  if (!referer) return null;
  try { return new URL(referer).hostname; } catch { return null; }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c),
  );
}

// ── Static HTML pages ──────────────────────────────────────────────────────────
// No user input is ever rendered into these — all dynamic values are escaped

function passwordPage(code: string, error: string | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Protected link</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .card{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.1);padding:2rem;width:100%;max-width:360px;text-align:center}
    h1{font-size:1.1rem;font-weight:600;margin:0 0 .5rem}
    p{color:#6b7280;font-size:.875rem;margin:0 0 1.5rem}
    .err{background:#fef2f2;color:#dc2626;border-radius:8px;padding:.5rem .75rem;font-size:.8rem;margin-bottom:1rem;text-align:left}
    input{width:100%;padding:.625rem .875rem;border:1px solid #e5e7eb;border-radius:8px;font-size:.875rem;outline:none;box-sizing:border-box;margin-bottom:1rem}
    input:focus{border-color:#4f6ef7;box-shadow:0 0 0 3px rgba(79,110,247,.15)}
    button{width:100%;padding:.75rem;background:#4f6ef7;color:#fff;border:none;border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer}
    button:hover{background:#3b5bf6}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:2rem;margin-bottom:1rem">🔒</div>
    <h1>Password protected link</h1>
    <p>Enter the password to continue to your destination.</p>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/${escapeHtml(code)}">
      <input type="password" name="pwd" placeholder="Enter password" autofocus required autocomplete="current-password">
      <button type="submit">Continue →</button>
    </form>
  </div>
</body>
</html>`;
}

function notFoundPage(code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Link not found</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}h1{font-size:4rem;font-weight:700;color:#111827;margin:0}p{color:#6b7280}a{color:#4f6ef7;text-decoration:none}</style>
</head>
<body><div><h1>404</h1><p>The link <strong>${escapeHtml(code)}</strong> does not exist.</p><a href="${env.SHORT_BASE_URL}">← link-click</a></div></body>
</html>`;
}

function expiredPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Link expired</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}h1{font-size:4rem;font-weight:700;color:#111827;margin:0}p{color:#6b7280}a{color:#4f6ef7;text-decoration:none}</style>
</head>
<body><div><h1>410</h1><p>This link has expired or reached its click limit.</p><a href="${env.SHORT_BASE_URL}">← link-click</a></div></body>
</html>`;
}
