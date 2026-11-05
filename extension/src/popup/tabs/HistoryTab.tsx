import React, { useState } from 'react';
import { useStore } from '../../store/useStore';
import { api } from '../../api/client';
import { removeFromHistory } from '../../utils/history';
import { copyToClipboard } from '../../utils/clipboard';
import { displayUrl } from '../../utils/validation';

export default function HistoryTab(): React.ReactElement {
  const { links, setLinks, user, setView, setActiveTab } = useStore();
  const [search, setSearch] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const filtered = q ? links.filter((l) => l.shortCode.toLowerCase().includes(q) || l.longUrl.toLowerCase().includes(q)) : links;

  async function handleCopy(shortUrl: string, code: string): Promise<void> {
    if (await copyToClipboard(shortUrl)) {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    }
  }

  async function handleDelete(code: string): Promise<void> {
    setError(null);
    if (user) {
      if (!confirm('Delete this link? It will stop redirecting.')) return;
      setBusyCode(code);
      const res = await api.deleteLink(code);
      setBusyCode(null);
      if (res.error && res.status !== 404) {
        setError(res.error);
        return;
      }
    }
    // Anonymous links can't be deleted on the server (spec §7.6); this only forgets it locally.
    await removeFromHistory(code);
    setLinks(links.filter((l) => l.shortCode !== code));
  }

  const isExpired = (exp: string | null): boolean => !!exp && new Date(exp) < new Date();

  if (links.length === 0) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center gap-2 text-center">
        <div className="text-sm font-medium text-gray-700">No links yet</div>
        <div className="text-xs text-gray-500">Links you shorten will appear here.</div>
        <button onClick={() => setActiveTab('shorten')} className="btn-secondary mt-2">Shorten a link</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 flex flex-col gap-2">
        <input type="search" placeholder="Filter links…" value={search} onChange={(e) => setSearch(e.target.value)} className="input py-1.5" />
        {!user && (
          <div className="text-[11px] text-gray-500">
            Saved on this device only.{' '}
            <button onClick={() => setView('login')} className="text-brand-600 font-semibold hover:underline">Sign in</button> to sync and see clicks.
          </div>
        )}
        {error && <div className="alert-error">{error}</div>}
      </div>

      <ul className="scrollable flex-1 px-3 pb-3 flex flex-col gap-1.5">
        {filtered.length === 0 && <li className="text-xs text-gray-400 text-center pt-6">No links match “{search}”.</li>}
        {filtered.map((link) => (
          <li
            key={link.shortCode}
            className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-100 cursor-pointer hover:border-brand-200 hover:bg-brand-50 transition ${isExpired(link.expiresAt) ? 'opacity-60' : ''}`}
            onClick={() => void handleCopy(link.shortUrl, link.shortCode)}
            title="Click to copy"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono font-semibold text-brand-700 truncate">{displayUrl(link.shortUrl)}</span>
                {isExpired(link.expiresAt) && <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 rounded shrink-0">expired</span>}
              </div>
              <div className="text-[11px] text-gray-500 truncate">{link.longUrl}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                {user && <>{link.clickCount.toLocaleString()} {link.clickCount === 1 ? 'click' : 'clicks'} · </>}
                {new Date(link.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); void handleCopy(link.shortUrl, link.shortCode); }}
                className="text-[11px] px-2 py-1 rounded text-brand-600 hover:bg-brand-100 font-semibold"
              >
                {copiedCode === link.shortCode ? '✓' : 'Copy'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void handleDelete(link.shortCode); }}
                disabled={busyCode === link.shortCode}
                aria-label={user ? 'Delete link' : 'Remove from history'}
                title={user ? 'Delete link' : 'Remove from history'}
                className="text-[11px] px-2 py-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
              >
                {busyCode === link.shortCode ? '…' : '✕'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
