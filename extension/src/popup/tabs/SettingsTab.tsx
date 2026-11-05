import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { api } from '../../api/client';
import { storage, type Settings } from '../../utils/storage';
import { clearHistory } from '../../utils/history';

type Check = 'idle' | 'checking' | 'ok' | 'fail';

export default function SettingsTab({ onSignedOut }: { onSignedOut: () => void }): React.ReactElement {
  const { user, setView } = useStore();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [check, setCheck] = useState<{ api: Check; analytics: Check }>({ api: 'idle', analytics: 'idle' });

  useEffect(() => {
    void storage.getSettings().then(setSettings);
  }, []);

  if (!settings) return <div />;

  const validUrl = (u: string): boolean => /^https?:\/\/[^\s/]+/i.test(u.trim());
  const canSave = validUrl(settings.apiBaseUrl) && validUrl(settings.analyticsBaseUrl);

  async function save(): Promise<void> {
    if (!settings || !canSave) return;
    await storage.setSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    await testConnection();
  }

  async function testConnection(): Promise<void> {
    setCheck({ api: 'checking', analytics: 'checking' });
    const [a, b] = await Promise.all([api.health('api'), api.health('analytics')]);
    setCheck({ api: a.data ? 'ok' : 'fail', analytics: b.data ? 'ok' : 'fail' });
  }

  async function reset(): Promise<void> {
    await storage.resetEndpoints();
    setSettings(await storage.getSettings());
    setCheck({ api: 'idle', analytics: 'idle' });
  }

  async function signOut(): Promise<void> {
    await api.logout(); // best effort: revoke the refresh token server-side
    await storage.clearAuth();
    await clearHistory();
    onSignedOut();
  }

  async function toggleNotify(v: boolean): Promise<void> {
    setSettings((s) => (s ? { ...s, notifyOnContextMenu: v } : s));
    await storage.setSettings({ notifyOnContextMenu: v });
  }

  return (
    <div className="p-4 flex flex-col gap-5 h-full scrollable">
      <section className="flex flex-col gap-2">
        <div className="label">Account</div>
        {user ? (
          <div className="bg-gray-50 rounded-lg px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{user.displayName || user.email}</div>
              {user.displayName && <div className="text-[11px] text-gray-500 truncate">{user.email}</div>}
              <div className="text-[11px] text-gray-500 capitalize">{user.tier} plan</div>
            </div>
            <button onClick={() => void signOut()} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50 shrink-0">Sign out</button>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg px-3 py-2.5 flex items-center justify-between">
            <span className="text-xs text-gray-600">Not signed in</span>
            <button onClick={() => setView('login')} className="btn-secondary">Sign in</button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="label">Notifications</div>
        <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
          <input type="checkbox" checked={settings.notifyOnContextMenu} onChange={(e) => void toggleNotify(e.target.checked)} className="accent-brand-500" />
          Notify when a link is shortened from the right-click menu
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <div className="label">Server</div>
        <p className="text-[11px] text-gray-500 -mt-1">For self-hosted or local link-click instances.</p>
        <Field label="API (write service)" status={check.api} value={settings.apiBaseUrl} onChange={(v) => setSettings({ ...settings, apiBaseUrl: v })} />
        <Field label="Analytics service" status={check.analytics} value={settings.analyticsBaseUrl} onChange={(v) => setSettings({ ...settings, analyticsBaseUrl: v })} />
        <div className="flex gap-2">
          <button onClick={() => void save()} disabled={!canSave} className="btn-secondary bg-brand-500 text-white border-brand-500 hover:bg-brand-600 flex-1">
            {saved ? '✓ Saved' : 'Save & test'}
          </button>
          <button onClick={() => void reset()} className="btn-secondary">Reset</button>
        </div>
      </section>

      <footer className="mt-auto text-center text-[11px] text-gray-400">link-click v{chrome.runtime.getManifest().version}</footer>
    </div>
  );
}

function Field({ label, value, onChange, status }: { label: string; value: string; onChange: (v: string) => void; status: Check }): React.ReactElement {
  const badge = {
    idle: null,
    checking: <span className="text-gray-400">checking…</span>,
    ok: <span className="text-green-600">● reachable</span>,
    fail: <span className="text-red-600">● unreachable</span>,
  }[status];
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-600 flex justify-between">{label} <span className="text-[11px]">{badge}</span></span>
      <input type="url" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} className="input font-mono text-xs" />
    </label>
  );
}
