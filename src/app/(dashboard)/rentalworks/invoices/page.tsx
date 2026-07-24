'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * RentalWorks invoices — the AR workspace.
 *
 * Every mirrored RW invoice, searchable and filterable, with the HQ context
 * stitched on: which client it belongs to, and whether its order is linked
 * to a job. Reads the mirror (never RW live), so a token expiry shows as a
 * stale sync badge rather than a silent $0.
 */

type Inv = {
  id: string; invoiceNumber: string | null; orderNumber: string | null;
  customerName: string | null; status: string | null;
  invoiceDate: string | null; dueDate: string | null; poNumber: string | null;
  invoiceTotal: number; receivedTotal: number; remainingTotal: number;
  company: { id: string; name: string } | null;
  job: { id: string; jobCode: string; name: string } | null;
};

type Payload = {
  syncedAt: string | null;
  count: number;
  totals: { invoiced: number; outstanding: number; openCount: number; overdue: number; overdueCount: number };
  invoices: Inv[];
};

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
  { key: 'void', label: 'Void' },
  { key: 'all', label: 'All' },
] as const;

const usd = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmt = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const ago = (d: string | null) => {
  if (!d) return 'never';
  const h = Math.floor((Date.now() - new Date(d).getTime()) / 3_600_000);
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

const PAGE = 100;

export default function RwInvoicesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [filter, setFilter] = useState<string>('open');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshErr, setRefreshErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ filter, limit: String(PAGE), offset: String(offset) });
    if (term) p.set('q', term);
    const r = await fetch(`/api/rentalworks/invoices?${p}`);
    setData(r.ok ? await r.json() : null);
    setLoading(false);
  }, [filter, term, offset]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true); setRefreshErr(null);
    try {
      const r = await fetch('/api/admin/rw-invoice-sync', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setRefreshErr(
          String(d.error || '').match(/401|403/)
            ? 'RentalWorks rejected the token — it likely needs rotating.'
            : d.error || `Sync failed (HTTP ${r.status})`,
        );
        return;
      }
      await load();
    } finally { setRefreshing(false); }
  };

  const t = data?.totals;

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1400px] mx-auto">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-lt-fg">RentalWorks Invoices</h1>
            <p className="text-[12px] text-lt-fg3">
              Accounts receivable mirrored from RentalWorks · synced {ago(data?.syncedAt ?? null)}
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-lg border border-lt-hairline bg-lt-card text-[12px] font-semibold text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh from RW'}
          </button>
        </div>

        {refreshErr && (
          <div className="mb-4 text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {refreshErr}
          </div>
        )}
        {refreshing && (
          <div className="mb-4 text-[12px] text-lt-fg3">Pulling all invoices from RentalWorks — about 30 seconds.</div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Tile label="Outstanding" value={t ? usd(t.outstanding) : '—'} tone="warn" />
          <Tile label="Overdue" value={t ? usd(t.overdue) : '—'} sub={t ? `${t.overdueCount} past due` : undefined} tone="bad" />
          <Tile label="Invoiced" value={t ? usd(t.invoiced) : '—'} />
          <Tile label="Open invoices" value={t ? String(t.openCount) : '—'} sub={data ? `${data.count} in view` : undefined} />
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setOffset(0); }}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                filter === f.key
                  ? 'bg-lt-fg text-lt-card border-lt-fg'
                  : 'bg-lt-card text-lt-fg2 border-lt-hairline hover:text-lt-fg'
              }`}
            >
              {f.label}
            </button>
          ))}
          <form
            onSubmit={(e) => { e.preventDefault(); setOffset(0); setTerm(q.trim()); }}
            className="flex items-center gap-2 ml-auto"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search invoice #, order #, or client…"
              className="px-3 py-1.5 w-72 bg-lt-card border border-lt-hairline rounded-lg text-[13px] text-lt-fg focus:outline-none focus:border-lt-fg3"
            />
            <button className="px-3 py-1.5 rounded-lg bg-lt-fg text-lt-card text-[12px] font-semibold">Search</button>
            {term && (
              <button
                type="button"
                onClick={() => { setQ(''); setTerm(''); setOffset(0); }}
                className="text-[12px] text-lt-fg3 hover:text-lt-fg"
              >
                Clear
              </button>
            )}
          </form>
        </div>

        <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-lt-fg3 border-b border-lt-hairline">
                  <th className="py-2 px-3 font-semibold">Invoice</th>
                  <th className="py-2 px-3 font-semibold">Order</th>
                  <th className="py-2 px-3 font-semibold">Client</th>
                  <th className="py-2 px-3 font-semibold">Status</th>
                  <th className="py-2 px-3 font-semibold">Job</th>
                  <th className="py-2 px-3 font-semibold">Dated</th>
                  <th className="py-2 px-3 font-semibold">Due</th>
                  <th className="py-2 px-3 font-semibold text-right">Total</th>
                  <th className="py-2 px-3 font-semibold text-right">Received</th>
                  <th className="py-2 px-3 font-semibold text-right">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={9} className="py-6 text-center text-lt-fg3">Loading…</td></tr>
                )}
                {!loading && data?.invoices.length === 0 && (
                  <tr><td colSpan={9} className="py-6 text-center text-lt-fg3">No invoices match.</td></tr>
                )}
                {!loading && data?.invoices.map((i) => {
                  const overdue = i.remainingTotal > 0.005 && i.dueDate && new Date(i.dueDate).getTime() < Date.now();
                  return (
                    <tr key={i.id} className="border-b border-lt-hairline/60 hover:bg-lt-inner">
                      <td className="py-2 px-3 font-mono text-lt-fg">{i.invoiceNumber || '—'}</td>
                      <td className="py-2 px-3 font-mono text-lt-fg2">{i.orderNumber || '—'}</td>
                      <td className="py-2 px-3 text-lt-fg truncate max-w-[220px]">
                        {i.company ? (
                          <Link href={`/crm/${i.company.id}`} className="hover:underline">{i.company.name}</Link>
                        ) : (
                          <span title="No HQ company matched to this RW customer">{i.customerName || '—'}</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                          i.status === 'VOID' ? 'bg-gray-100 text-gray-500 border-gray-200'
                          : i.status === 'CLOSED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>{i.status || '—'}</span>
                      </td>
                      <td className="py-2 px-3">
                        {i.job ? (
                          <Link href={`/jobs/${i.job.id}`} className="text-[12px] font-semibold text-blue-700 hover:underline">
                            {i.job.jobCode}
                          </Link>
                        ) : (
                          <span className="text-[11px] text-lt-fg3">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-lt-fg2">{fmt(i.invoiceDate)}</td>
                      <td className={`py-2 px-3 ${overdue ? 'text-rose-600 font-semibold' : 'text-lt-fg2'}`}>{fmt(i.dueDate)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-lt-fg">{usd(i.invoiceTotal)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-lt-fg2">{usd(i.receivedTotal)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-semibold ${i.remainingTotal > 0.005 ? 'text-lt-fg' : 'text-lt-fg3'}`}>
                        {usd(i.remainingTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data && data.count > PAGE && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-lt-hairline text-[12px]">
              <span className="text-lt-fg3">
                {offset + 1}–{Math.min(offset + PAGE, data.count)} of {data.count}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                  className="px-2.5 py-1 rounded border border-lt-hairline disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  disabled={offset + PAGE >= data.count}
                  onClick={() => setOffset(offset + PAGE)}
                  className="px-2.5 py-1 rounded border border-lt-hairline disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-lt-fg3 mt-3">
          Quotes can’t be listed here — RentalWorks’ quote endpoint is broken (500), so quotes only
          exist in HQ once their PDF is attached to a job.
        </p>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'bad' }) {
  const cls = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-lt-fg';
  return (
    <div className="p-4 bg-lt-card rounded-xl border border-lt-hairline">
      <div className="text-[9px] font-bold text-lt-fg3 uppercase mb-1">{label}</div>
      <div className={`text-2xl font-extrabold tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-lt-fg3 mt-0.5">{sub}</div>}
    </div>
  );
}
