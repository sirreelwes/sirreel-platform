'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Client AR from RentalWorks, read from the HQ mirror (sr_rw_invoices).
 *
 * Never fetches RW live: RW can't filter invoice/browse, and live-fetching
 * is how the legacy dashboards silently render $0 on a token expiry. The
 * mirror shows its own age instead — stale data announces itself.
 */

type RwInv = {
  id: string;
  invoiceNumber: string | null;
  invoiceType: string | null;
  status: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  orderNumber: string | null;
  poNumber: string | null;
  invoiceTotal: number;
  receivedTotal: number;
  remainingTotal: number;
};

type Ar = {
  linked: boolean;
  syncedAt: string | null;
  totals?: {
    invoiced: number; received: number; outstanding: number;
    openCount: number; overdueCount: number; overdueAmount: number;
  };
  invoices: RwInv[];
};

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function fmt(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ago(d: string | null) {
  if (!d) return 'never';
  const ms = Date.now() - new Date(d).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ClientArPanel({ companyId }: { companyId: string }) {
  const [ar, setAr] = useState<Ar | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/crm/companies/${companyId}/rw-ar`);
    if (!r.ok) { setAr({ linked: false, syncedAt: null, invoices: [] }); return; }
    setAr(await r.json());
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  if (!ar) return null;

  if (!ar.linked) {
    return (
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-lt-fg mb-1">Accounts Receivable</h2>
        <p className="text-[12px] text-lt-fg3">
          This client isn’t linked to a RentalWorks customer, so no invoices can be matched.
        </p>
      </div>
    );
  }

  const t = ar.totals!;
  const open = ar.invoices.filter((i) => i.remainingTotal > 0.005);
  const shown = showAll ? ar.invoices : open;
  const stale = ar.syncedAt ? Date.now() - new Date(ar.syncedAt).getTime() > 36 * 3_600_000 : true;

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="text-sm font-semibold text-lt-fg">Accounts Receivable</h2>
          <span className="text-[11px] text-lt-fg3">from RentalWorks</span>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
              stale
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}
            title={ar.syncedAt ? new Date(ar.syncedAt).toLocaleString() : 'never synced'}
          >
            synced {ago(ar.syncedAt)}
          </span>
        </div>
        {ar.invoices.length > open.length && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-[12px] font-semibold text-lt-fg2 hover:text-lt-fg"
          >
            {showAll ? 'Show open only' : `Show all ${ar.invoices.length}`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Tile label="Outstanding" value={usd(t.outstanding)} tone={t.outstanding > 0 ? 'warn' : 'good'} />
        <Tile label="Open invoices" value={String(t.openCount)} />
        <Tile label="Overdue" value={usd(t.overdueAmount)} sub={`${t.overdueCount} past due`} tone={t.overdueAmount > 0 ? 'bad' : 'good'} />
        <Tile label="Lifetime invoiced" value={usd(t.invoiced)} />
      </div>

      {shown.length === 0 ? (
        <div className="text-[13px] text-lt-fg3 italic">No open invoices — paid in full.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-lt-fg3 border-b border-lt-hairline">
                <th className="py-1.5 pr-3 font-semibold">Invoice</th>
                <th className="py-1.5 pr-3 font-semibold">Order</th>
                <th className="py-1.5 pr-3 font-semibold">Dated</th>
                <th className="py-1.5 pr-3 font-semibold">Due</th>
                <th className="py-1.5 pr-3 font-semibold text-right">Total</th>
                <th className="py-1.5 pr-3 font-semibold text-right">Received</th>
                <th className="py-1.5 font-semibold text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 60).map((i) => {
                const overdue = i.remainingTotal > 0.005 && i.dueDate && new Date(i.dueDate).getTime() < Date.now();
                return (
                  <tr key={i.id} className="border-b border-lt-hairline/60">
                    <td className="py-1.5 pr-3 font-mono text-lt-fg">{i.invoiceNumber || '—'}</td>
                    <td className="py-1.5 pr-3 font-mono text-lt-fg2">{i.orderNumber || '—'}</td>
                    <td className="py-1.5 pr-3 text-lt-fg2">{fmt(i.invoiceDate)}</td>
                    <td className={`py-1.5 pr-3 ${overdue ? 'text-rose-600 font-semibold' : 'text-lt-fg2'}`}>
                      {fmt(i.dueDate)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-lt-fg">{usd(i.invoiceTotal)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-lt-fg2">{usd(i.receivedTotal)}</td>
                    <td className={`py-1.5 text-right tabular-nums font-semibold ${i.remainingTotal > 0.005 ? 'text-lt-fg' : 'text-lt-fg3'}`}>
                      {usd(i.remainingTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length > 60 && (
            <div className="text-[11px] text-lt-fg3 mt-2">Showing first 60 of {shown.length}.</div>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const cls = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-700' : tone === 'good' ? 'text-emerald-700' : 'text-lt-fg';
  return (
    <div className="border border-lt-hairline rounded-lg p-3 bg-lt-inner">
      <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">{label}</div>
      <div className={`mt-1 text-[18px] font-bold tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] text-lt-fg3 mt-0.5">{sub}</div>}
    </div>
  );
}
