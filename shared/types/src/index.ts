// ─── User ────────────────────────────────────────────────────────────────────

export type UserTier = 'free' | 'pro' | 'enterprise';
export type OAuthProvider = 'google' | 'github';

export interface User {
  id: bigint;
  email: string;
  displayName: string | null;
  tier: UserTier;
  oauthProvider: OAuthProvider | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface JwtPayload {
  sub: string; // user id as string (bigint → string for JSON)
  email: string;
  tier: UserTier;
  iat: number;
  exp: number;
}

// ─── URL / Short Link ─────────────────────────────────────────────────────────

export interface ShortLink {
  id: bigint;
  shortCode: string;
  longUrl: string;
  longUrlHash: string;
  userId: bigint | null;
  isCustom: boolean;
  isActive: boolean;
  isFlagged: boolean;
  hasPassword: boolean;
  maxClicks: number | null;
  clickCount: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
}

// ─── Click Event ──────────────────────────────────────────────────────────────

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'bot';

export interface ClickEvent {
  shortCode: string;
  clickedAt: string; // ISO 8601
  ipHash: string;
  userAgent: string;
  country: string | null; // ISO 3166-1 alpha-2
  city: string | null;
  deviceType: DeviceType;
  browser: string | null;
  os: string | null;
  referrer: string | null;
  referrerDomain: string | null;
  isUnique: boolean;
}

// ─── API Request / Response shapes ───────────────────────────────────────────

export interface ShortenRequest {
  longUrl: string;
  customAlias?: string;
  expiresAt?: string; // ISO 8601
  password?: string;
  maxClicks?: number;
  tags?: string[];
}

export interface ShortenResponse {
  shortUrl: string;
  shortCode: string;
  longUrl: string;
  isNew: boolean; // false if deduped from existing link
  expiresAt: string | null;
}

export interface LinkListItem {
  shortCode: string;
  shortUrl: string;
  longUrl: string;
  clickCount: number;
  isActive: boolean;
  isCustom: boolean;
  expiresAt: string | null;
  createdAt: string;
  tags: string[];
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  shortCode: string;
  totalClicks: number;
  uniqueClicks: number;
  topCountries: Record<string, number>;
  topDevices: Record<DeviceType, number>;
  topReferrers: Record<string, number>;
  periodStart: string;
  periodEnd: string;
}

export interface TimeseriesPoint {
  bucket: string; // ISO 8601 truncated to hour or day
  totalClicks: number;
  uniqueClicks: number;
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  anonymous: number;   // per hour
  free: number;        // per hour
  pro: number;         // per hour
}

export const RATE_LIMITS: RateLimitConfig = {
  anonymous: 10,
  free: 50,
  pro: 500,
};

// ─── API Key ──────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: bigint;
  userId: bigint;
  label: string | null;
  lastUsedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

// ─── Error shapes ─────────────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}
