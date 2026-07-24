'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * RentalWorks billing for a Job.
 *
 * RW invoices carry an OrderNumber, so the job is linked to its RW ORDER
 * and every invoice on that order (now and future) rolls up automatically.
 * Candidates come from the HQ mirror filtered to this client's RW customer
 * and ranked by how close their first invoice is to the job's start date —
 * a human still confirms, because mis-attributing money is worse than a
 * little clicking.
 */

type Inv = {
  id: string; invoiceNumber: string | null; status: string | null;
  invoiceDate: string | null; dueDate: string | null; orderNumber: string | null;
  invoiceTotal: number; receivedTotal: number; remainingTotal: number;
};
type Cand = {
  orderNumber: string; invoiceCount: number; invoiced: number; outstanding: number;
  firstInvoiceDate: string | null; lastInvoiceDate: string | null; distanceDays: number | null;
};
type Data = {
  companyLinked: boolean; companyName: string | null;
  linked: { rwOrderNumber: string }[];
  syncedAt: string | null;
  rollup: { invoiced: number; received: number; outstanding: number; openCount: number; invoiceCount: number };
  invoices: Inv[];
  candidates: Cand[];
};

const usd = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmt = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export function JobRwBillingPanel({ jobId }: { jobId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/jobs/${jobId}/rw-orders`);
    if (!r.ok) { setData(null); return; }
    setData(await r.json());
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const link = async (orderNumber: string) => {
    if (!orderNumber.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/jobs/${jobId}/rw-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rwOrderNumber: orderNumber.trim() }),
      });
      setManual('');
      setPicking(false);
      await load();
    } finally { setBusy(false); }
  };

  const unlink = async (orderNumber: string) => {
    if (!window.confirm(`Unlink RW order #${orderNumber} from this job?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/jobs/${jobId}/rw-orders?orderNumber=${encodeURIComponent(orderNumber)}`, { method: 'DELETE' });
      await load();
    } finally { setBusy(false); }
  };

  if (!data) return null;
  const hasLinks = data.linked.length > 0;

  return (
    <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
      <div className="flex items-center justify-between mb-2.5 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
            RentalWorks billing
          </h2>
          {hasLinks && (
            <span className="text-[12px] text-zinc-300">
              order{data.linked.length > 1 ? 's' : ''}{' '}
              {data.linked.map((l) => `#${l.rwOrderNumber}`).join(', ')}
            </span>
          )}
        </div>
        <button
          onClick={() => setPicking((v) => !v)}
          disabled={busy}
          className="text-[13px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-amber-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {picking ? 'Close' : '+ Link RW order'}
        </button>
      </div>

      {hasLinks && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
            <Tile label="Outstanding" value={usd(data.rollup.outstanding)} tone={data.rollup.outstanding > 0 ? 'warn' : 'good'} />
            <Tile label="Received" value={usd(data.rollup.received)} />
            <Tile label="Invoiced" value={usd(data.rollup.invoiced)} />
            <Tile label="Open" value={`${data.rollup.openCount} of ${data.rollup.invoiceCount}`} />
          </div>
          {data.invoices.length > 0 && (
            <div className="overflow-x-auto mb-2">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                    <th className="py-1.5 pr-3 font-semibold">Invoice</th>
                    <th className="py-1.5 pr-3 font-semibold">Dated</th>
                    <th className="py-1.5 pr-3 font-semibold">Due</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Total</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Received</th>
                    <th className="py-1.5 font-semibold text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((i) => {
                    const overdue = i.remainingTotal > 0.005 && i.dueDate && new Date(i.dueDate).getTime() < Date.now();
                    return (
                      <tr key={i.id} className="border-b border-zinc-800/60">
                        <td className="py-1.5 pr-3 font-mono text-white">{i.invoiceNumber || '—'}</td>
                        <td className="py-1.5 pr-3 text-zinc-300">{fmt(i.invoiceDate)}</td>
                        <td className={`py-1.5 pr-3 ${overdue ? 'text-rose-400 font-semibold' : 'text-zinc-300'}`}>{fmt(i.dueDate)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-white">{usd(i.invoiceTotal)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-300">{usd(i.receivedTotal)}</td>
                        <td className={`py-1.5 text-right tabular-nums font-semibold ${i.remainingTotal > 0.005 ? 'text-white' : 'text-zinc-400'}`}>
                          {usd(i.remainingTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap text-[11px] text-zinc-400">
            {data.syncedAt && <span>synced {fmt(data.syncedAt)}</span>}
            {data.linked.map((l) => (
              <button key={l.rwOrderNumber} onClick={() => unlink(l.rwOrderNumber)} className="hover:text-rose-400">
                Unlink #{l.rwOrderNumber}
              </button>
            ))}
          </div>
        </>
      )}

      {!hasLinks && !picking && (
        <div className="text-[14px] text-zinc-300 border border-dashed border-zinc-800 rounded-xl px-4 py-4 text-center bg-zinc-950/40">
          No RentalWorks order linked. Link one to pull this job’s invoices and balance in from RW.
        </div>
      )}

      {picking && (
        <div className="mt-1 rounded-xl border border-zinc-700 bg-zinc-950/60 p-3">
          {!data.companyLinked ? (
            <div className="text-[13px] text-zinc-300">
              {data.companyName || 'This client'} isn’t linked to a RentalWorks customer, so we can’t
              suggest orders. Enter the RW order number directly:
            </div>
          ) : (
            <div className="text-[12px] text-zinc-400 mb-2">
              Orders for {data.companyName}, closest to this job’s start date first:
            </div>
          )}

          {data.candidates.length > 0 && (
            <div className="space-y-1.5 mb-3 max-h-72 overflow-y-auto">
              {data.candidates.map((c) => (
                <button
                  key={c.orderNumber}
                  onClick={() => link(c.orderNumber)}
                  disabled={busy}
                  className="w-full text-left flex items-center gap-3 flex-wrap rounded-lg border border-zinc-800 bg-zinc-900 hover:border-amber-600/60 px-3 py-2 transition-colors disabled:opacity-50"
                >
                  <span className="font-mono text-[14px] text-white">#{c.orderNumber}</span>
                  <span className="text-[12px] text-zinc-300">
                    {c.invoiceCount} invoice{c.invoiceCount === 1 ? '' : 's'} · {usd(c.invoiced)}
                  </span>
                  {c.outstanding > 0.005 && (
                    <span className="text-[12px] text-amber-300">{usd(c.outstanding)} open</span>
                  )}
                  <span className="text-[11px] text-zinc-400">{fmt(c.firstInvoiceDate)}</span>
                  {c.distanceDays != null && (
                    <span className="text-[11px] text-zinc-400 ml-auto">
                      {c.distanceDays === 0 ? 'same day' : `${c.distanceDays}d from job start`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="RW order number, e.g. 304209"
              className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[14px] text-white focus:outline-none focus:border-zinc-500"
            />
            <button
              onClick={() => link(manual)}
              disabled={busy || !manual.trim()}
              className="px-3 py-1.5 text-[13px] font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg disabled:opacity-40"
            >
              Link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  const cls = tone === 'warn' ? 'text-amber-300' : tone === 'good' ? 'text-emerald-300' : 'text-white';
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{label}</div>
      <div className={`mt-1 text-[16px] font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
