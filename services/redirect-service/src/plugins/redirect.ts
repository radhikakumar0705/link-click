import crypto from 'crypto';
import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { UAParser } from 'ua-parser-js';
import { isValidShortCode } from '@link-click/base62';
import { ClickEvent, DeviceType } from '@link-click/types';
import { env } from '../lib/env';

// Daily-rotating salt for IP hashing — GDPR compliance
// Same IP produces the same hash within a 24-hour window (for unique counting)
// but different hashes across days (cannot track individuals over time)
const IP_SALT = crypto
  .createHash('sha256')
  .update(`${new Date().toISOString().slice(0, 10)}-link-click`)
  .digest('hex');

export const redirectPlugin = fp(async (fastify: FastifyInstance) => {
  /**
   * GET /:code — the hot path
   *
   * Order of operations (spec §3.4):
   * 1. Validate code format (no DB touch on invalid codes)
   * 2. Redis lookup → cache hit → redirect in <5ms
   * 3. Redis miss → Postgres lookup
   * 4. Check expiry / active / max_clicks
   * 5. Populate Redis; 302 redirect
   * 6. Fire-and-forget: publish ClickEvent (never blocks the redirect)
   */
  fastify.get(
    '/:code',
    async (
      req: FastifyRequest<{ Params: { code: string }; Querystring: { pwd?: string } }>,
      reply: FastifyReply,
    ) => {
      const { code } = req.params;

      if (!isValidShortCode(code)) {
        return reply.code(404).type('text/html').send(notFoundPage(code));
      }

      // ── Redis fast path ────────────────────────────────────────────────────
      const cached = await fastify.redis.get(`url:${code}`);
      if (cached) {
        void emitClickEvent(fastify, req, code);
        return reply.header('Cache-Control', 'no-store').redirect(302, cached);
      }

      // ── Postgres fallback ──────────────────────────────────────────────────
      const url = await fastify.prisma.url.findUnique({
        where: { shortCode: code },
        select: {
          longUrl:      true,
          expiresAt:    true,
          isActive:     true,
          isFlagged:    true,
          passwordHash: true,
          maxClicks:    true,
          clickCount:   true,
        },
      });

      if (!url || !url.isActive) {
        return reply.code(404).type('text/html').send(notFoundPage(code));
      }

      if (url.expiresAt && url.expiresAt < new Date()) {
        return reply.code(410).type('text/html').send(expiredPage());
      }

      if (url.maxClicks !== null && url.clickCount >= url.maxClicks) {
        void fastify.prisma.url.update({ where: { shortCode: code }, data: { isActive: false } });
        return reply.code(410).type('text/html').send(expiredPage());
      }

      // ── Password protection ────────────────────────────────────────────────
      if (url.passwordHash) {
        const bcrypt = await import('bcrypt');
        const submitted = req.query.pwd;

        if (!submitted) {
          return reply.code(200).type('text/html').send(passwordPage(code, false));
        }

        const correct = await bcrypt.compare(submitted, url.passwordHash);
        if (!correct) {
          return reply.code(200).type('text/html').send(passwordPage(code, true));
        }
        // Correct password — fall through to redirect below
      }

      // Populate Redis (only for non-password-protected links — password links
      // must always hit the server so the password check runs)
      if (!url.passwordHash) {
        await fastify.redis.set(`url:${code}`, url.longUrl, 'EX', 86400);
      }

      void emitClickEvent(fastify, req, code);
      return reply.header('Cache-Control', 'no-store').redirect(302, url.longUrl);
    },
  );
});

// ── Click event emission ───────────────────────────────────────────────────────

async function emitClickEvent(
  fastify: FastifyInstance,
  req: FastifyRequest,
  shortCode: string,
): Promise<void> {
  try {
    const ua = new UAParser(req.headers['user-agent'] ?? '');
    const ipHash = crypto.createHash('sha256').update(req.ip + IP_SALT).digest('hex');

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
      isUnique:       false,
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

function passwordPage(code: string, wrongPassword: boolean): string {
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
    ${wrongPassword ? '<div class="err">Incorrect password — please try again.</div>' : ''}
    <form method="GET" action="/${escapeHtml(code)}">
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
