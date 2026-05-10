'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MarkLostModal } from './MarkLostModal';

type Scope = 'my' | 'team';

interface StaleQuote {
  id: string;
  orderNumber: string;
  total: number;
  daysSinceSent: number | null;
  job: { id: string; jobCode: string; name: string } | null;
  company: { id: string; name: string } | null;
  agent: { id: string; name: string } | null;
}

interface PendingCoi {
  id: string;
  createdAt: string;
  company: { id: string; name: string } | null;
  job: { id: string; jobCode: string; name: string } | null;
}

interface DormantClient {
  id: string;
  name: string;
  lastReturnedAt: string | null;
  defaultAgent: { id: string; name: string } | null;
}

interface SignalsResponse {
  scope: Scope;
  staleQuotes: StaleQuote[];
  pendingCoi: PendingCoi[];
  unlinkedEmailCount: number;
  dormantClients: DormantClient[];
}

type PanelKey = 'stale' | 'dormant' | 'coi' | 'inbox';

function fmtMoney(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export function SalesSignalsStrip({ scope, onChange }: { scope: Scope; onChange?: () => void }) {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [open, setOpen] = useState<PanelKey | null>(null);
  const [lostJob, setLostJob] = useState<{ id: string; name: string; jobCode: string; company: { name: string } } | null>(null);

  const load = useCallback(() => {
    fetch(`/api/sales/signals?scope=${scope}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null));
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  const counts = {
    stale: data?.staleQuotes.length ?? 0,
    dormant: data?.dormantClients.length ?? 0,
    coi: data?.pendingCoi.length ?? 0,
    inbox: data?.unlinkedEmailCount ?? 0,
  };

  const chips: Array<{ key: PanelKey; label: string; tone: string }> = [
    { key: 'stale',   label: 'Stale Quotes',          tone: 'border-amber-700 text-amber-200 bg-amber-900/20' },
    { key: 'dormant', label: 'Dormant Clients (60d+)', tone: 'border-zinc-700 text-zinc-200 bg-zinc-900/40' },
    { key: 'coi',     label: 'Pending COIs',          tone: 'border-purple-800 text-purple-200 bg-purple-900/20' },
    { key: 'inbox',   label: 'Unlinked Emails',       tone: 'border-blue-800 text-blue-200 bg-blue-900/20' },
  ];

  const total = counts.stale + counts.dormant + counts.coi + counts.inbox;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Signals</span>
        {data == null && <span className="text-[11px] text-gray-400">Loading…</span>}
        {data != null && total === 0 && (
          <span className="text-[11px] text-gray-400">All clear — nothing needs attention.</span>
        )}
        {chips.map((c) => {
          const n = counts[c.key];
          const active = open === c.key;
          if (n === 0) return null;
          return (
            <button
              key={c.key}
              onClick={() => setOpen(active ? null : c.key)}
              className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${c.tone} ${active ? 'ring-2 ring-amber-500/40' : 'hover:brightness-110'}`}
            >
              {c.label} <span className="ml-1 font-mono">{n}</span>
            </button>
          );
        })}
      </div>

      {open === 'stale' && (
        <Panel title="Quotes with no client response">
          {data?.staleQuotes.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-zinc-800">
              {data?.staleQuotes.map((q) => {
                const overWeek = (q.daysSinceSent ?? 0) >= 7;
                return (
                  <li
                    key={q.id}
                    className={`py-2 flex items-center justify-between gap-3 flex-wrap ${overWeek ? 'bg-red-900/10 -mx-4 px-4' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white truncate">
                        {q.job ? (
                          <Link href={`/jobs/${q.job.id}`} className="hover:underline">
                            {q.job.name}
                          </Link>
                        ) : q.orderNumber}
                        <span className="text-[10px] text-zinc-500 font-mono ml-2">{q.orderNumber}</span>
                        {overWeek && (
                          <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-red-300 bg-red-900/40 px-1.5 py-0.5 rounded">
                            7d+
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {q.company?.name || '—'}
                        {q.agent && <> · {q.agent.name}</>}
                        {q.daysSinceSent != null && <> · sent {q.daysSinceSent}d ago</>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-mono text-amber-400">{fmtMoney(q.total)}</span>
                      {q.job && (
                        <button
                          onClick={() =>
                            setLostJob({
                              id: q.job!.id,
                              name: q.job!.name,
                              jobCode: q.job!.jobCode,
                              company: { name: q.company?.name || '—' },
                            })
                          }
                          className="text-[10px] font-semibold text-red-300 hover:text-red-200 px-1.5 py-0.5 rounded hover:bg-red-900/30 transition-colors"
                        >
                          Mark Lost
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {open === 'dormant' && (
        <Panel title="Repeat clients gone quiet">
          {data?.dormantClients.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-zinc-800">
              {data?.dormantClients.map((c) => {
                const days = daysSince(c.lastReturnedAt);
                return (
                  <li key={c.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <Link href={`/crm/${c.id}`} className="text-sm text-white hover:underline truncate block">
                        {c.name}
                      </Link>
                      <div className="text-[11px] text-zinc-500">
                        {c.defaultAgent ? `Owner: ${c.defaultAgent.name}` : 'No assigned agent'}
                        {days != null && <> · last rental {days}d ago</>}
                      </div>
                    </div>
                    <Link
                      href={`/crm/${c.id}`}
                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-semibold rounded border border-zinc-700"
                    >
                      Open
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {open === 'coi' && (
        <Panel title="COI checks awaiting review">
          {data?.pendingCoi.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-zinc-800">
              {data?.pendingCoi.map((c) => {
                const days = daysSince(c.createdAt);
                return (
                  <li key={c.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white truncate">
                        {c.company?.name || '—'}
                        {c.job && <span className="text-[10px] text-zinc-500 font-mono ml-2">{c.job.jobCode}</span>}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {days != null ? `pending ${days}d` : 'pending'}
                      </div>
                    </div>
                    <Link
                      href="/tools/coi-check"
                      className="px-2.5 py-1 bg-purple-900/40 hover:bg-purple-900/60 text-purple-200 text-[11px] font-semibold rounded border border-purple-800"
                    >
                      Review
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {open === 'inbox' && (
        <Panel title="Inbound emails not yet linked to a client">
          <p className="text-[12px] text-zinc-400 mb-2">
            {counts.inbox} inbound email{counts.inbox === 1 ? '' : 's'} aren&rsquo;t tied to a known company or contact yet.
          </p>
          <Link
            href="/inbox"
            className="inline-block px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold rounded"
          >
            Open Inbox
          </Link>
        </Panel>
      )}

      <MarkLostModal
        job={lostJob}
        onClose={() => setLostJob(null)}
        onMarked={() => { setLostJob(null); load(); onChange?.(); }}
      />
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-[12px] text-zinc-500">Nothing here.</p>;
}
