/**
 * Local link history in chrome.storage.local (spec §3.3 step 9).
 *
 * - Signed in: the server list is the source of truth; it replaces the local copy on popup open.
 * - Anonymous: this device's list is all there is.
 * Links shortened from the context menu are written here by the service worker,
 * so they show up in the popup even if it was closed at the time (spec §7.4).
 */
import type { LinkListItem, ShortenResponse } from '../api/client';
import { HISTORY_LIMIT } from '../config';

const KEY = 'recentLinks';

export async function getHistory(): Promise<LinkListItem[]> {
  const r = await chrome.storage.local.get(KEY);
  return (r[KEY] as LinkListItem[] | undefined) ?? [];
}

export const setHistory = (links: LinkListItem[]): Promise<void> =>
  chrome.storage.local.set({ [KEY]: links.slice(0, HISTORY_LIMIT) });

export async function addToHistory(res: ShortenResponse, isCustom: boolean): Promise<LinkListItem[]> {
  const existing = await getHistory();
  const prev = existing.find((l) => l.shortCode === res.shortCode);
  const item: LinkListItem = {
    shortCode: res.shortCode,
    shortUrl: res.shortUrl,
    longUrl: res.longUrl,
    clickCount: prev?.clickCount ?? 0,
    isActive: true,
    isCustom,
    expiresAt: res.expiresAt,
    createdAt: prev?.createdAt ?? new Date().toISOString(),
    tags: prev?.tags ?? [],
  };
  const next = [item, ...existing.filter((l) => l.shortCode !== res.shortCode)];
  await setHistory(next);
  return next;
}

export async function removeFromHistory(code: string): Promise<void> {
  await setHistory((await getHistory()).filter((l) => l.shortCode !== code));
}

export const clearHistory = (): Promise<void> => chrome.storage.local.remove(KEY);

export const HISTORY_KEY = KEY;
