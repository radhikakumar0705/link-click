/**
 * Manifest V3 service worker.
 *
 * 1. Right-click menu: "Shorten link" on hyperlinks and "Shorten this page" on pages.
 * 2. Copies the result via the offscreen document and records it in local history.
 * 3. Refreshes the JWT every 55 minutes (spec §6.3), and on browser start-up.
 *
 * Listeners are registered synchronously at top level, as MV3 requires, so they
 * fire after the worker is woken from idle.
 */
import { api, refreshAccessToken } from '../api/client';
import { addToHistory } from '../utils/history';
import { storage } from '../utils/storage';
import { unshortenableReason } from '../utils/validation';

const MENU_LINK = 'link-click-shorten-link';
const MENU_PAGE = 'link-click-shorten-page';
const REFRESH_ALARM = 'token-refresh';

chrome.runtime.onInstalled.addListener(() => {
  // removeAll first so an update never fails with "duplicate id"
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_LINK, title: 'Shorten link with link-click', contexts: ['link'] });
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: 'Shorten this page with link-click',
      contexts: ['page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
  void ensureRefreshAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureRefreshAlarm();
  void refreshIfSignedIn();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) void refreshIfSignedIn();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.menuItemId === MENU_LINK ? info.linkUrl : info.menuItemId === MENU_PAGE ? (info.pageUrl ?? tab?.url) : undefined;
  if (url) void shortenFromMenu(url);
});

// ── Context-menu shorten ─────────────────────────────────────────────────────

async function shortenFromMenu(url: string): Promise<void> {
  const reason = unshortenableReason(url);
  if (reason) return notify("Can't shorten this link", reason, true);

  const res = await api.shorten({ longUrl: url });
  if (!res.data) return notify("Couldn't shorten link", res.error ?? 'Unknown error', true);

  await addToHistory(res.data, false);
  const copied = await copyToClipboard(res.data.shortUrl);
  await notify(
    copied ? 'Short link copied' : 'Short link ready',
    copied ? res.data.shortUrl : `${res.data.shortUrl} — open link-click to copy it.`,
  );
}

async function notify(title: string, message: string, isError = false): Promise<void> {
  const { notifyOnContextMenu } = await storage.getSettings();
  if (!notifyOnContextMenu && !isError) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: isError ? 1 : 0,
  });
}

// ── Clipboard via offscreen document ─────────────────────────────────────────

const OFFSCREEN_PATH = 'offscreen/offscreen.html';
let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (contexts.length > 0) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Copy the newly created short link to the clipboard.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await ensureOffscreen();
    const res = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'copy', text })) as { ok?: boolean } | undefined;
    return !!res?.ok;
  } catch {
    return false;
  } finally {
    // Close it so it doesn't linger; it's cheap to recreate.
    chrome.offscreen.closeDocument().catch(() => undefined);
  }
}

// ── Token refresh ────────────────────────────────────────────────────────────

async function ensureRefreshAlarm(): Promise<void> {
  if (!(await chrome.alarms.get(REFRESH_ALARM))) {
    await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 55 });
  }
}

async function refreshIfSignedIn(): Promise<void> {
  if (await storage.getAuth()) await refreshAccessToken();
}
