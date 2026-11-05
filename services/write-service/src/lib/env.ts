import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // Accepts postgresql:// and postgres:// schemes
  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Keys are stored with literal \n in env files — transform them to real newlines
  JWT_PRIVATE_KEY: z.string().transform((k) => k.replace(/\\n/g, '\n')),
  JWT_PUBLIC_KEY:  z.string().transform((k) => k.replace(/\\n/g, '\n')),
  JWT_ACCESS_TTL:  z.string().default('1h'),

  KAFKA_BROKERS: z.string().default('localhost:9092'),

  SAFE_BROWSING_API_KEY: z.string().optional(),

  GOOGLE_CLIENT_ID:     z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  EXTENSION_ORIGIN: z.string().default('chrome-extension://placeholder'),
  SHORT_BASE_URL:   z.string().default('http://localhost:3002'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Invalid environment variables:');
  console.error(JSON.stringify(result.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = result.data;
