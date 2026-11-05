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
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('❌ Invalid environment variables:', result.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = result.data;
