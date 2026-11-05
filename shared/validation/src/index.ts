import { z } from 'zod';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Reserved path segments that cannot be used as custom aliases.
 * Prevents shadowing API routes (e.g. snplink.io/api, snplink.io/auth).
 */
export const RESERVED_ALIASES = new Set([
  'api', 'auth', 'admin', 'static', 'health', 'analytics',
  'dashboard', 'login', 'register', 'logout', 'settings',
  'user', 'links', 'shorten', 'qr', 'export',
]);

const PRIVATE_IP_REGEX =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|localhost)/i;

// ─── URL validation ───────────────────────────────────────────────────────────

/**
 * Validates and normalises a long URL before shortening.
 * Enforces the security rules from spec §7.1.
 */
export const longUrlSchema = z
  .string()
  .max(2048, 'URL must be 2048 characters or fewer')
  .transform((url) => url.trim())
  .refine(
    (url) => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid URL including scheme (https://...)' },
  )
  .refine(
    (url) => {
      const { protocol } = new URL(url);
      return protocol === 'https:' || protocol === 'http:';
    },
    { message: 'Only http and https URLs are supported' },
  )
  .refine(
    (url) => {
      const { hostname } = new URL(url);
      return !PRIVATE_IP_REGEX.test(hostname);
    },
    { message: 'Private or loopback IP addresses cannot be shortened (SSRF prevention)' },
  );

// ─── Custom alias validation ──────────────────────────────────────────────────

export const customAliasSchema = z
  .string()
  .min(3, 'Custom alias must be at least 3 characters')
  .max(50, 'Custom alias must be 50 characters or fewer')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Only letters, numbers, hyphens, and underscores are allowed')
  .refine((alias) => !RESERVED_ALIASES.has(alias.toLowerCase()), {
    message: 'This alias is reserved and cannot be used',
  });

// ─── Shorten request ──────────────────────────────────────────────────────────

export const shortenRequestSchema = z.object({
  longUrl: longUrlSchema,
  customAlias: customAliasSchema.optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  password: z
    .string()
    .min(4, 'Password must be at least 4 characters')
    .max(100)
    .optional(),
  maxClicks: z.number().int().positive().max(1_000_000).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

export type ShortenRequestInput = z.infer<typeof shortenRequestSchema>;

// ─── Pagination ───────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tag: z.string().optional(),
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one digit'),
  displayName: z.string().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Analytics query ──────────────────────────────────────────────────────────

export const analyticsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  granularity: z.enum(['hour', 'day']).default('day'),
});
