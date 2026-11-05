import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3003),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // chrome-extension://<id> — the only browser origin allowed in production (spec §8.4)
  EXTENSION_ORIGIN: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().transform((k) => k.replace(/\\n/g, '\n')),
  FREE_TIER_ANALYTICS_DAYS: z.coerce.number().default(7),
  PRO_TIER_ANALYTICS_DAYS:  z.coerce.number().default(90),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('❌ Invalid environment variables:', result.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = result.data;
