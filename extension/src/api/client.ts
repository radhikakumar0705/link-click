/**
 * Typed API client, shared by the popup and the service worker.
 *
 * - Reads endpoints and the JWT from chrome.storage on every call, so a
 *   change in Settings or a token rotated by the service worker is picked up.
 * - 401 → refresh the access token once → retry (spec §7.4).
 * - Never throws: every call resolves to { data, error, status }.
 */
import { storage } from '../utils/storage';

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
  status: number; // 0 = network failure
  details?: Record<string, unknown>;
}

type Service = 'api' | 'analytics';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  service?: Service;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Exchanges the refresh token for a new pair. Concurrent callers share one request. */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const auth = await storage.getAuth();
    if (!auth?.refreshToken) return false;
    const { apiBaseUrl } = await storage.getSettings();
    try {
      const res = await fetch(`${apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      });
      if (res.status === 401 || res.status === 403) {
        await storage.clearAuth(); // refresh token revoked or expired → signed out
        return false;
      }
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      await storage.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false; // offline — keep tokens, try again later
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function request<T>(path: string, opts: RequestOptions = {}, isRetry = false): Promise<ApiResult<T>> {
  const { method = 'GET', body, auth = true, service = 'api' } = opts;
  const settings = await storage.getSettings();
  const base = service === 'analytics' ? settings.analyticsBaseUrl : settings.apiBaseUrl;
  const token = auth ? (await storage.getAuth())?.accessToken : undefined;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return {
      data: null,
      status: 0,
      error: offline
        ? "You're offline. Reconnect and try again."
        : `Can't reach the link-click server at ${base}. Check the endpoint in Settings.`,
    };
  }

  if (res.status === 401 && token && !isRetry) {
    if (await refreshAccessToken()) return request<T>(path, opts, true);
    return { data: null, status: 401, error: 'Your session expired. Please sign in again.' };
  }

  if (res.status === 204) return { data: null, error: null, status: 204 };

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    const j = (json ?? {}) as { message?: string; error?: string; details?: Record<string, unknown> };
    return { data: null, status: res.status, error: friendlyError(res.status, j.message ?? j.error), details: j.details };
  }
  return { data: json as T, error: null, status: res.status };
}

function friendlyError(status: number, message?: string): string {
  if (message && message !== 'Bad Request' && message !== 'Invalid request body') return message;
  switch (status) {
    case 400: return 'The server rejected this URL or option.';
    case 403: return "You don't have access to this link.";
    case 404: return 'Not found.';
    case 429: return 'Rate limit reached. Try again later.';
    default:  return status >= 500 ? 'The server had a problem. Try again shortly.' : `Request failed (${status}).`;
  }
}

// ── Shapes (mirror services/write-service & analytics-service) ───────────────

export interface ShortenRequest {
  longUrl: string;
  customAlias?: string;
  expiresAt?: string; // ISO 8601 with offset
}

export interface ShortenResponse {
  shortUrl: string;
  shortCode: string;
  longUrl: string;
  isNew: boolean;
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

export interface PaginatedLinks {
  data: LinkListItem[];
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
}

export interface AnalyticsSummary {
  shortCode: string;
  totalClicks: number;
  uniqueClicks: number;
  topCountries: Record<string, number>;
  topDevices: Record<string, number>;
  topReferrers: Record<string, number>;
}

export interface TimeseriesPoint {
  bucket: string;
  totalClicks: number;
  uniqueClicks: number;
}

export interface PublicUser {
  id: string;
  email: string;
  tier: string;
  displayName: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export const api = {
  shorten: (body: ShortenRequest) =>
    request<ShortenResponse>('/shorten', { method: 'POST', body }),

  getLinks: (page = 1, limit = 50) =>
    request<PaginatedLinks>(`/user/links?page=${page}&limit=${limit}`),

  deleteLink: (code: string) =>
    request<null>(`/user/links/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  getAnalyticsSummary: (code: string, from: string, to: string) =>
    request<AnalyticsSummary>(
      `/analytics/${encodeURIComponent(code)}?${new URLSearchParams({ from, to })}`,
      { service: 'analytics' },
    ),

  getTimeseries: (code: string, from: string, to: string) =>
    request<TimeseriesPoint[]>(
      `/analytics/${encodeURIComponent(code)}/timeseries?${new URLSearchParams({ granularity: 'day', from, to })}`,
      { service: 'analytics' },
    ),

  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false }),

  register: (email: string, password: string, displayName?: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: { email, password, displayName }, auth: false }),

  logout: async () => {
    const auth = await storage.getAuth();
    return request<null>('/auth/logout', { method: 'POST', body: { refreshToken: auth?.refreshToken ?? '' } });
  },

  getMe: () => request<PublicUser>('/auth/me'),

  health: (service: Service) => request<{ status: string }>('/health', { auth: false, service }),
};
