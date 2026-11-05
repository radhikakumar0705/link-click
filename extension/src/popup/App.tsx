import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useStore, type Tab } from '../store/useStore';
import { api, type LinkListItem } from '../api/client';
import { storage } from '../utils/storage';
import { getHistory, setHistory, HISTORY_KEY } from '../utils/history';
import ShortenTab from './tabs/ShortenTab';
import HistoryTab from './tabs/HistoryTab';
// Recharts is most of the bundle; load it only when the Analytics tab opens.
const AnalyticsTab = lazy(() => import('./tabs/AnalyticsTab'));
import SettingsTab from './tabs/SettingsTab';
import LoginView from './LoginView';
import Logo from './Logo';

const TABS: { id: Tab; label: string }[] = [
  { id: 'shorten', label: 'Shorten' },
  { id: 'history', label: 'History' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Settings' },
];

export default function App(): React.ReactElement {
  const { activeTab, setActiveTab, user, setUser, setLinks, view, setView } = useStore();
  const [booting, setBooting] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);

  /** Restore session, then show cached history immediately and refresh it from the server. */
  const load = useCallback(async () => {
    setLinks(await getHistory());
    const auth = await storage.getAuth();
    if (!auth) {
      setUser(null);
      return;
    }
    // Show the cached identity right away; confirm with the server in the background.
    setUser({ id: auth.userId, email: auth.email, tier: auth.tier, displayName: auth.displayName });
    const [me, links] = await Promise.all([api.getMe(), api.getLinks(1, 50)]);
    if (me.status === 401) {
      setUser(null);
      return;
    }
    if (me.data) setUser(me.data);
    if (links.data) {
      setLinks(links.data.data);
      await setHistory(links.data.data);
    }
  }, [setLinks, setUser]);

  useEffect(() => {
    void load().finally(() => setBooting(false));

    // Keep every open popup in sync (spec §7.4): sign-out elsewhere, context-menu shortens, etc.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area !== 'local') return;
      if (changes[HISTORY_KEY]) setLinks((changes[HISTORY_KEY].newValue as LinkListItem[] | undefined) ?? []);
      if (changes.accessToken && !changes.accessToken.newValue) setUser(null);
    };
    chrome.storage.onChanged.addListener(onChanged);

    const on = (): void => setOffline(false);
    const off = (): void => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [load, setLinks, setUser]);

  if (booting) {
    return (
      <div className="h-full flex items-center justify-center text-brand-500">
        <span className="spinner w-6 h-6" />
      </div>
    );
  }

  if (view === 'login') {
    return <LoginView onDone={() => { setView('main'); void load(); }} onCancel={() => setView('main')} />;
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo className="w-6 h-6" />
          <span className="font-bold text-gray-900 tracking-tight">link-click</span>
        </div>
        {user ? (
          <span className="text-[11px] font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 capitalize" title={user.email}>
            {user.tier}
          </span>
        ) : (
          <button onClick={() => setView('login')} className="text-xs font-semibold text-brand-600 hover:text-brand-700">
            Sign in
          </button>
        )}
      </header>

      {offline && (
        <div className="text-[11px] text-center text-amber-800 bg-amber-50 border-b border-amber-100 py-1">
          You're offline — shortening will work again once you reconnect.
        </div>
      )}

      <nav className="flex border-b border-gray-100" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === t.id ? 'text-brand-600 border-brand-500' : 'text-gray-500 border-transparent hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 min-h-0">
        {activeTab === 'shorten' && <ShortenTab />}
        {activeTab === 'history' && <HistoryTab />}
        {activeTab === 'analytics' && (
          <Suspense fallback={<div className="flex justify-center py-10 text-brand-500"><span className="spinner w-5 h-5" /></div>}>
            <AnalyticsTab />
          </Suspense>
        )}
        {activeTab === 'settings' && <SettingsTab onSignedOut={() => void load()} />}
      </main>
    </div>
  );
}
