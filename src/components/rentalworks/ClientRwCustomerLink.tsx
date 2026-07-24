'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Link an HQ client to its RentalWorks customer — the prerequisite for any
 * RW invoice/AR to reach that client and its jobs. Candidates are ranked by
 * name similarity (from the invoice mirror, no extra RW calls); a match
 * already claimed by another HQ company is flagged so you don't double-link.
 */

type Cand = {
  rwCustomerId: string;
  name: string;
  invoiceCount: number;
  outstanding: number;
  score: number;
  takenByOtherCompany: string | null;
  isCurrent: boolean;
};
type Data = { companyName: string; currentRwCustomerId: string | null; candidates: Cand[] };

const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function ClientRwCustomerLink({
  companyId,
  onLinked,
}: {
  companyId: string;
  onLinked?: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/crm/companies/${companyId}/rw-customer`);
    setData(r.ok ? await r.json() : null);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const link = async (rwCustomerId: string) => {
    if (!rwCustomerId.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/crm/companies/${companyId}/rw-customer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rwCustomerId: rwCustomerId.trim() }),
      });
      setManual('');
      await load();
      onLinked?.();
    } finally { setBusy(false); }
  };

  const unlink = async () => {
    if (!window.confirm('Unlink this client from its RentalWorks customer? Its RW invoices will stop showing.')) return;
    setBusy(true);
    try {
      await fetch(`/api/crm/companies/${companyId}/rw-customer`, { method: 'DELETE' });
      await load();
      onLinked?.();
    } finally { setBusy(false); }
  };

  if (!data) return null;

  return (
    <div className="rounded-lg border border-lt-hairline bg-lt-inner p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-lt-fg3">RentalWorks customer</div>
        {data.currentRwCustomerId && (
          <button onClick={unlink} disabled={busy} className="text-[11px] text-lt-fg3 hover:text-rose-600">Unlink</button>
        )}
      </div>

      {data.currentRwCustomerId ? (
        <div className="text-[12px] text-lt-fg2 mb-2">
          Linked to{' '}
          <span className="font-mono text-lt-fg">{data.currentRwCustomerId}</span>
          {data.candidates.find((c) => c.isCurrent)?.name && (
            <> — {data.candidates.find((c) => c.isCurrent)!.name}</>
          )}
          . Pick a different match below if this is wrong.
        </div>
      ) : (
        <div className="text-[12px] text-lt-fg3 mb-2">
          Not linked yet. Pick the RentalWorks customer that matches {data.companyName}:
        </div>
      )}

      <div className="space-y-1.5">
        {data.candidates.filter((c) => !c.isCurrent).map((c) => (
          <div key={c.rwCustomerId} className={`flex items-center gap-2 flex-wrap rounded-lg border px-3 py-1.5 ${c.score >= 0.5 ? 'border-amber-300 bg-amber-50/50' : 'border-lt-hairline bg-lt-card'}`}>
            <span className="text-[13px] font-semibold text-lt-fg">{c.name}</span>
            <span className="text-[11px] text-lt-fg3">{c.invoiceCount} inv · {usd(c.outstanding)} open</span>
            <span className="text-[10px] text-lt-fg3">{Math.round(c.score * 100)}% name match</span>
            {c.takenByOtherCompany && (
              <span className="text-[10px] font-semibold text-rose-600" title="Already linked to another HQ client">
                ⚠ linked to {c.takenByOtherCompany}
              </span>
            )}
            <button
              onClick={() => link(c.rwCustomerId)}
              disabled={busy}
              className="ml-auto text-[11px] font-semibold px-2.5 py-1 rounded bg-lt-fg text-lt-card hover:opacity-90 disabled:opacity-40"
            >
              Link
            </button>
          </div>
        ))}
        {data.candidates.filter((c) => !c.isCurrent).length === 0 && (
          <div className="text-[12px] text-lt-fg3">No close name matches. Enter the RW customer id directly:</div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="RW customer id, e.g. A00013AC"
          className="flex-1 px-2.5 py-1.5 bg-lt-card border border-lt-hairline rounded-lg text-[12px] text-lt-fg focus:outline-none focus:border-lt-fg3"
        />
        <button onClick={() => link(manual)} disabled={busy || !manual.trim()} className="px-3 py-1.5 rounded-lg bg-lt-fg text-lt-card text-[12px] font-semibold disabled:opacity-40">
          Link
        </button>
      </div>
    </div>
  );
}
