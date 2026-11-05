import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { api } from '../../api/client';
import { addToHistory } from '../../utils/history';
import { copyToClipboard } from '../../utils/clipboard';
import { aliasError, displayUrl, hasCredentials, unshortenableReason } from '../../utils/validation';

export default function ShortenTab(): React.ReactElement {
  const { user, lastResult, setLastResult, setLinks, setView } = useStore();
  const [url, setUrl] = useState('');
  const [customAlias, setCustomAlias] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // Pre-fill with the active tab's URL (readable thanks to activeTab when the popup opens).
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setUrl(tab?.url ?? ''));
  }, []);

  const urlProblem = url ? unshortenableReason(url.trim()) : null;
  const aliasProblem = aliasError(customAlias.trim());
  const credentialWarning = !urlProblem && hasCredentials(url.trim());

  async function handleShorten(): Promise<void> {
    const longUrl = url.trim();
    if (!longUrl || urlProblem || aliasProblem) return;
    setError(null);
    setAlternatives([]);
    setLoading(true);
    setLastResult(null);

    const alias = user ? customAlias.trim() || undefined : undefined;
    const res = await api.shorten({
      longUrl,
      customAlias: alias,
      // <input type="datetime-local"> is local time with no offset; the API requires ISO 8601 with offset.
      expiresAt: user && expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
    setLoading(false);

    if (!res.data) {
      setError(res.error ?? 'Failed to shorten URL.');
      const alts = (res.details?.alternatives as string[] | undefined) ?? [];
      if (res.status === 409) setAlternatives(alts);
      return;
    }

    const { shortUrl, shortCode } = res.data;
    setLastResult({ shortUrl, shortCode });
    setLinks(await addToHistory(res.data, !!alias));
    setCustomAlias('');
    setExpiresAt('');

    if (await copyToClipboard(shortUrl)) flashCopied();
  }

  function flashCopied(): void {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Minimum for datetime-local: now, in local time.
  const minExpiry = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

  return (
    <div className="p-4 flex flex-col gap-3 h-full scrollable">
      <label className="label" htmlFor="url">URL to shorten</label>
      <textarea
        id="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setLastResult(null);
        }}
        rows={3}
        spellCheck={false}
        className="input font-mono text-xs resize-none break-all"
        placeholder="https://…"
      />

      {urlProblem && <div className="alert-warn">{urlProblem}</div>}
      {credentialWarning && (
        <div className="alert-warn">This URL contains a username/password. They'll be removed before the link is saved.</div>
      )}

      {user ? (
        <>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-brand-600 hover:text-brand-700 text-left font-medium"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? '▾ Hide options' : '▸ Custom alias & expiry'}
          </button>
          {showAdvanced && (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                placeholder="Custom alias (e.g. my-product)"
                value={customAlias}
                onChange={(e) => setCustomAlias(e.target.value)}
                className="input"
                maxLength={30}
              />
              {aliasProblem && <div className="text-[11px] text-red-600">{aliasProblem}</div>}
              <label className="text-xs text-gray-500" htmlFor="exp">Expires (optional)</label>
              <input id="exp" type="datetime-local" value={expiresAt} min={minExpiry} onChange={(e) => setExpiresAt(e.target.value)} className="input" />
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] text-gray-500">
          <button onClick={() => setView('login')} className="text-brand-600 font-semibold hover:underline">Sign in</button> for
          custom aliases, expiry dates, synced history and analytics.
        </p>
      )}

      {error && <div className="alert-error">{error}</div>}
      {alternatives.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[11px] text-gray-500">Try:</span>
          {alternatives.map((a) => (
            <button key={a} onClick={() => { setCustomAlias(a); setAlternatives([]); setError(null); }} className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-100 hover:bg-brand-50 hover:text-brand-700">
              {a}
            </button>
          ))}
        </div>
      )}

      {lastResult && (
        <div className="bg-brand-50 border border-brand-100 rounded-lg px-3 py-3 flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] text-brand-700 font-medium">{copied ? 'Copied to clipboard' : 'Short link ready'}</span>
            <a href={lastResult.shortUrl} target="_blank" rel="noreferrer" className="text-sm font-mono font-semibold text-brand-700 truncate hover:underline">
              {displayUrl(lastResult.shortUrl)}
            </a>
          </div>
          <button
            onClick={() => void copyToClipboard(lastResult.shortUrl).then((ok) => ok && flashCopied())}
            className="shrink-0 text-xs px-3 py-1.5 bg-brand-500 text-white rounded-md hover:bg-brand-600 font-semibold"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      )}

      <button onClick={() => void handleShorten()} disabled={loading || !url.trim() || !!urlProblem || !!aliasProblem} className="btn-primary mt-auto">
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="spinner w-3.5 h-3.5" /> Shortening…
          </span>
        ) : (
          'Shorten & copy'
        )}
      </button>
    </div>
  );
}
