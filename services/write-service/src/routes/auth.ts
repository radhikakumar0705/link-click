import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { registerSchema, loginSchema } from '@link-click/validation';

const BCRYPT_ROUNDS = 10;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Generate a cryptographically random refresh token and its stored hash.
// The raw token is sent to the client once. Only the hash is ever persisted.
function generateRefreshToken(): { raw: string; hash: string } {
  const raw = `rt_${crypto.randomBytes(40).toString('base64url')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /auth/register ────────────────────────────────────────────────────
  fastify.post('/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { email, password, displayName } = parsed.data;
    const existing = await fastify.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Email already registered',
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await fastify.prisma.user.create({
      data: { email, passwordHash, displayName: displayName ?? null, tier: 'free' },
    });

    const accessToken = fastify.jwt.sign({
      sub: user.id.toString(),
      email: user.email,
      tier: user.tier,
    });

    const { raw, hash } = generateRefreshToken();
    await fastify.redis.set(`refresh:${hash}`, user.id.toString(), 'EX', REFRESH_TTL_SECONDS);

    return reply.code(201).send({
      accessToken,
      refreshToken: raw,
      user: { id: user.id.toString(), email: user.email, tier: user.tier, displayName: user.displayName },
    });
  });

  // ── POST /auth/login ───────────────────────────────────────────────────────
  fastify.post('/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request' });
    }

    const { email, password } = parsed.data;
    const user = await fastify.prisma.user.findUnique({ where: { email } });

    // Constant-time failure — always run bcrypt even when user doesn't exist
    // so response time doesn't reveal whether the email is registered
    const dummyHash = '$2b$10$invalidhashpaddinginvalidhashpaddinginvalidhashpadding.';
    const hashToCheck = user?.passwordHash ?? dummyHash;
    const valid = await bcrypt.compare(password, hashToCheck);

    if (!user || !user.passwordHash || !valid) {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid credentials',
      });
    }

    const accessToken = fastify.jwt.sign({
      sub: user.id.toString(),
      email: user.email,
      tier: user.tier,
    });

    const { raw, hash } = generateRefreshToken();
    await fastify.redis.set(`refresh:${hash}`, user.id.toString(), 'EX', REFRESH_TTL_SECONDS);

    return reply.send({
      accessToken,
      refreshToken: raw,
      user: { id: user.id.toString(), email: user.email, tier: user.tier, displayName: user.displayName },
    });
  });

  // ── POST /auth/refresh ─────────────────────────────────────────────────────
  fastify.post(
    '/refresh',
    async (req: FastifyRequest<{ Body: { refreshToken?: string } }>, reply: FastifyReply) => {
      const raw = req.body?.refreshToken;
      if (!raw) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'refreshToken required' });
      }

      const hash = crypto.createHash('sha256').update(raw).digest('hex');
      // GETDEL (atomic): a refresh token is single-use. GET-then-DEL let two
      // concurrent requests both read the token and both get new token pairs.
      const userId = await fastify.redis.getdel(`refresh:${hash}`);

      if (!userId) {
        return reply.code(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or expired refresh token',
        });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: BigInt(userId) },
        select: { id: true, email: true, tier: true, isActive: true },
      });

      if (!user || !user.isActive) {
        return reply.code(401).send({ statusCode: 401, error: 'Unauthorized' });
      }

      // Rotate: the old token was already consumed by GETDEL; issue a new one.
      const { raw: newRaw, hash: newHash } = generateRefreshToken();
      await fastify.redis.set(`refresh:${newHash}`, user.id.toString(), 'EX', REFRESH_TTL_SECONDS);

      const accessToken = fastify.jwt.sign({
        sub: user.id.toString(),
        email: user.email,
        tier: user.tier,
      });

      return reply.send({ accessToken, refreshToken: newRaw });
    },
  );

  // ── POST /auth/logout ──────────────────────────────────────────────────────
  fastify.post(
    '/logout',
    { preHandler: fastify.authenticate },
    async (req: FastifyRequest<{ Body: { refreshToken?: string } }>, reply: FastifyReply) => {
      const raw = req.body?.refreshToken;
      if (raw) {
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        await fastify.redis.del(`refresh:${hash}`);
      }
      return reply.code(204).send();
    },
  );

  // ── GET /auth/me ───────────────────────────────────────────────────────────
  fastify.get(
    '/me',
    { preHandler: fastify.authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: BigInt(req.user.sub) },
        select: { id: true, email: true, displayName: true, tier: true, createdAt: true },
      });
      if (!user) return reply.code(404).send({ statusCode: 404, error: 'Not Found' });
      return reply.send({
        id: user.id.toString(),
        email: user.email,
        displayName: user.displayName,
        tier: user.tier,
        createdAt: user.createdAt.toISOString(),
      });
    },
  );
}
