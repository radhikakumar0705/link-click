import React, { useEffect, useState } from 'react';
import { BarChart, Bar, Tooltip, ResponsiveContainer, XAxis } from 'recharts';
import { useStore } from '../../store/useStore';
import { api, type AnalyticsSummary, type TimeseriesPoint } from '../../api/client';
import { displayUrl } from '../../utils/validation';

const DAY = 24 * 60 * 60 * 1000;

export default function AnalyticsTab(): React.ReactElement {
  const { links, user, setView } = useStore();
  const [selected, setSelected] = useState(links[0]?.shortCode ?? '');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !selected) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      // Free tier allows 7 days measured from the server's "now"; start a minute
      // inside that window so clock skew and request latency can't push us past it.
      const to = new Date();
      const from = new Date(to.getTime() - 7 * DAY + 60_000);
      const [s, t] = await Promise.all([
        api.getAnalyticsSummary(selected, from.toISOString(), to.toISOString()),
        api.getTimeseries(selected, from.toISOString(), to.toISOString()),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (!s.data) {
        setError(s.error);
        setSummary(null);
        return;
      }
      setSummary(s.data);
      setSeries(t.data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, user]);

  if (!user) {
    return (
      <Empty title="Analytics need an account" body="Sign in to see clicks, countries and devices for your links.">
        <button onClick={() => setView('login')} className="btn-secondary mt-2">Sign in</button>
      </Empty>
    );
  }
  if (links.length === 0) return <Empty title="No links yet" body="Shorten a link first, then come back to see how it performs." />;

  const top = (rec: Record<string, number> | undefined, n: number): [string, number][] =>
    Object.entries(rec ?? {}).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, n);
  const countries = top(summary?.topCountries, 3);
  const devices = top(summary?.topDevices, 4);
  const referrers = top(summary?.topReferrers, 3);
  const total = summary?.totalClicks || 1;

  return (
    <div className="p-4 flex flex-col gap-3 h-full scrollable">
      <select value={selected} onChange={(e) => setSelected(e.target.value)} className="input" aria-label="Link">
        {links.map((l) => (
          <option key={l.shortCode} value={l.shortCode}>{displayUrl(l.shortUrl)}</option>
        ))}
      </select>

      {loading && <div className="flex justify-center py-8 text-brand-500"><span className="spinner w-5 h-5" /></div>}
      {error && !loading && <div className="alert-error">{error}</div>}

      {summary && !loading && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Total clicks · 7d" value={summary.totalClicks} />
            <Stat label="Unique visitors" value={summary.uniqueClicks} />
          </div>

          {series.length > 0 && (
            <section className="bg-gray-50 rounded-lg p-3">
              <div className="label mb-2">Last 7 days</div>
              <ResponsiveContainer width="100%" height={64}>
                <BarChart data={series} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <XAxis dataKey="bucket" hide />
                  <Tooltip
                    cursor={{ fill: '#e0e9ff' }}
                    formatter={(v: number) => [v.toLocaleString(), 'Clicks']}
                    labelFormatter={(l: string) => new Date(l).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
                  />
                  <Bar dataKey="totalClicks" fill="#4f6ef7" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          )}

          {summary.totalClicks === 0 && <div className="text-xs text-gray-500 text-center py-2">No clicks in the last 7 days yet.</div>}

          <Breakdown title="Top countries" rows={countries} total={total} />
          <Breakdown title="Devices" rows={devices} total={total} capitalize />
          <Breakdown title="Top referrers" rows={referrers} total={total} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2.5">
      <div className="text-xl font-bold text-gray-900 tabular-nums">{value.toLocaleString()}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

function Breakdown({ title, rows, total, capitalize }: { title: string; rows: [string, number][]; total: number; capitalize?: boolean }): React.ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="label mb-1.5">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className={`text-gray-700 w-20 truncate ${capitalize ? 'capitalize' : ''}`} title={k}>{k || 'Direct'}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div className="bg-brand-500 h-full rounded-full" style={{ width: `${Math.min(100, (v / total) * 100)}%` }} />
            </div>
            <span className="text-gray-500 w-8 text-right tabular-nums">{v.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }): React.ReactElement {
  return (
    <div className="p-6 h-full flex flex-col items-center justify-center gap-1 text-center">
      <div className="text-sm font-medium text-gray-700">{title}</div>
      <div className="text-xs text-gray-500">{body}</div>
      {children}
    </div>
  );
}
