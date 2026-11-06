import { randomBytes } from 'crypto';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3002),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  SHORT_BASE_URL: z.string().default('http://localhost:3002'),
  COOKIE_SECRET: z.string().min(32).default('local-dev-cookie-secret-32chars!!'),
  // Secret key for hashing visitor IPs (ADR-006). Must be secret so hashes can't be
  // reversed by hashing all ~4B IPv4 addresses. Generate: openssl rand -hex 32
  IP_HASH_SECRET: z.string().min(32).optional(),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('❌ Invalid environment variables:', result.error.flatten().fieldErrors);
  process.exit(1);
}

if (!result.data.IP_HASH_SECRET) {
  if (result.data.NODE_ENV === 'production') {
    console.error('❌ IP_HASH_SECRET is required in production (openssl rand -hex 32)');
    process.exit(1);
  }
  // Dev fallback: random per process. Unique-visitor counts reset on restart, which is fine locally.
  result.data.IP_HASH_SECRET = randomBytes(32).toString('hex');
  console.warn('⚠ IP_HASH_SECRET not set — using a random per-process key (dev only)');
}

export const env = result.data as typeof result.data & { IP_HASH_SECRET: string };
