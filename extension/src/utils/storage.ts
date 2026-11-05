/**
 * Typed wrappers around chrome.storage.local — the single place storage keys live.
 * Works in the popup, the offscreen document and the service worker.
 */
import { DEFAULT_ANALYTICS_BASE_URL, DEFAULT_API_BASE_URL } from '../config';

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  tier: string;
  displayName: string | null;
}

export interface Settings {
  apiBaseUrl: string;
  analyticsBaseUrl: string;
  notifyOnContextMenu: boolean;
}

export const AUTH_KEYS = ['accessToken', 'refreshToken', 'userId', 'email', 'tier', 'displayName'] as const;
const SETTINGS_KEYS = ['apiBaseUrl', 'analyticsBaseUrl', 'notifyOnContextMenu'] as const;

const stripSlash = (url: string): string => url.trim().replace(/\/+$/, '');

export const storage = {
  async getAuth(): Promise<StoredAuth | null> {
    const r = await chrome.storage.local.get([...AUTH_KEYS]);
    if (typeof r.accessToken !== 'string' || !r.accessToken) return null;
    return {
      accessToken: r.accessToken,
      refreshToken: (r.refreshToken as string) ?? '',
      userId: r.userId as string,
      email: r.email as string,
      tier: (r.tier as string) ?? 'free',
      displayName: (r.displayName as string | null) ?? null,
    };
  },

  setAuth: (auth: StoredAuth): Promise<void> => chrome.storage.local.set(auth),

  setTokens: (accessToken: string, refreshToken: string): Promise<void> =>
    chrome.storage.local.set({ accessToken, refreshToken }),

  clearAuth: (): Promise<void> => chrome.storage.local.remove([...AUTH_KEYS]),

  async getSettings(): Promise<Settings> {
    const r = await chrome.storage.local.get([...SETTINGS_KEYS]);
    return {
      apiBaseUrl: stripSlash((r.apiBaseUrl as string) || DEFAULT_API_BASE_URL),
      analyticsBaseUrl: stripSlash((r.analyticsBaseUrl as string) || DEFAULT_ANALYTICS_BASE_URL),
      notifyOnContextMenu: (r.notifyOnContextMenu as boolean | undefined) ?? true,
    };
  },

  async setSettings(patch: Partial<Settings>): Promise<void> {
    const clean: Partial<Settings> = { ...patch };
    if (clean.apiBaseUrl !== undefined) clean.apiBaseUrl = stripSlash(clean.apiBaseUrl);
    if (clean.analyticsBaseUrl !== undefined) clean.analyticsBaseUrl = stripSlash(clean.analyticsBaseUrl);
    await chrome.storage.local.set(clean);
  },

  /** Restores the build-time endpoints by removing the user overrides. */
  resetEndpoints: (): Promise<void> => chrome.storage.local.remove(['apiBaseUrl', 'analyticsBaseUrl']),
};
