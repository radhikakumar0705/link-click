/**
 * Client-side pre-checks (spec §7.1 / §7.4). The server validates again;
 * these exist so the user gets an instant, specific message instead of a 400.
 */

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0|\[::1\]|.*\.local|.*\.localhost)$/i;

// Matches customAliasSchema / isValidShortCode on the server (12 = short_code column width).
export const ALIAS_PATTERN = /^[a-zA-Z0-9_-]{3,12}$/;
const RESERVED_ALIASES = new Set(['api', 'auth', 'admin', 'static', 'health', 'user', 'analytics']);

/** Returns null if the URL can be shortened, otherwise a user-facing reason. */
export function unshortenableReason(raw: string): string | null {
  if (!raw) return 'No URL to shorten.';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'This is not a valid URL.';
  }
  if (url.protocol === 'file:') return 'Local files (file://) are not publicly accessible.';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Browser internal pages cannot be shortened.';
  }
  if (PRIVATE_HOST.test(url.hostname)) return 'Local and private-network addresses cannot be shortened.';
  if (raw.length > 2048) return 'URL is longer than 2048 characters.';
  return null;
}

export function aliasError(alias: string): string | null {
  if (!alias) return null;
  if (!ALIAS_PATTERN.test(alias)) return 'Alias must be 3–12 characters: letters, numbers, - or _.';
  if (RESERVED_ALIASES.has(alias.toLowerCase())) return `"${alias}" is reserved.`;
  return null;
}

/** True if the URL contains user:pass@ — the server strips them, so warn the user. */
export function hasCredentials(raw: string): boolean {
  try {
    const u = new URL(raw);
    return !!(u.username || u.password);
  } catch {
    return false;
  }
}

/** "https://example.com/abc" → "example.com/abc" */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}
