'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { JobEmailThreads } from '@/components/jobs/JobEmailThreads';

/**
 * RentalWorks reconciliation workspace.
 *
 * Linking a job to an RW order is a judgement call — mis-linking attributes
 * real money to the wrong job. So this puts the evidence side by side: the
 * job, its client, its dates, who's on it, what they rented, and the email
 * trail — next to the candidate RW orders and their actual invoices.
 * Nothing auto-links; you confirm.
 */

type JobRow = {
  id: string; jobCode: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  company: { id: string; name: string } | null;
  companyRwLinked: boolean;
  linkedOrders: string[];
};

type CandInv = {
  id: string; invoiceNumber: string | null; status: string | null;
  invoiceDate: string | null; dueDate: string | null; poNumber: string | null;
  invoiceTotal: number; receivedTotal: number; remainingTotal: number;
};
type Cand = {
  orderNumber: string; invoiceCount: number; invoiced: number; outstanding: number;
  firstInvoiceDate: string | null; lastInvoiceDate: string | null; distanceDays: number | null;
  dealName: string | null; orderDescription: string | null; agent: string | null;
  billingStartDate: string | null; billingEndDate: string | null;
  score: number; reasons: string[];
  invoices?: CandInv[];
};
type RwData = {
  companyLinked: boolean; companyName: string | null;
  jobName?: string | null; jobAgent?: string | null;
  linked: { rwOrderNumber: string }[];
  rollup: { invoiced: number; received: number; outstanding: number; openCount: number; invoiceCount: number };
  invoices: CandInv[];
  candidates: Cand[];
};

type JobDetail = {
  jobCode: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  productionType: string;
  company: { id: string; name: string };
  agent: { name: string } | null;
  jobContacts: Array<{ id: string; role: string; isPrimary: boolean;
    person: { firstName: string; lastName: string; email: string; phone: string | null } }>;
  orders: Array<{ id: string; orderNumber: string; status: string;
    lineItems: Array<{ id: string; description: string; quantity: number }> }>;
  bookings: Array<{ items: Array<{ category: { name: string };
    assignments: Array<{ asset: { unitName: string } }> }> }>;
  notes: string | null;
};

const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function ReconcilePage() {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [filter, setFilter] = useState<'unlinked' | 'linked' | 'all'>('unlinked');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    const p = new URLSearchParams({ filter });
    if (term) p.set('q', term);
    const r = await fetch(`/api/rentalworks/reconcile/jobs?${p}`);
    const d = r.ok ? await r.json() : { jobs: [] };
    setJobs(d.jobs);
    if (!selected && d.jobs.length) setSelected(d.jobs[0].id);
  }, [filter, term, selected]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1600px] mx-auto">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-lt-fg">Reconcile RentalWorks orders</h1>
          <p className="text-[12px] text-lt-fg3">
            Confirm which RW order belongs to each job — with the client, the rental and the email
            trail in view. Nothing links automatically.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
          {/* ── Left rail: jobs to work through ── */}
          <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
            <div className="p-3 border-b border-lt-hairline space-y-2">
              <div className="flex gap-1.5">
                {(['unlinked', 'linked', 'all'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border capitalize ${
                      filter === f ? 'bg-lt-fg text-lt-card border-lt-fg' : 'bg-lt-card text-lt-fg2 border-lt-hairline'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Job, client…"
                  className="w-full px-2.5 py-1.5 bg-lt-inner border border-lt-hairline rounded-lg text-[12px] text-lt-fg focus:outline-none focus:border-lt-fg3"
                />
              </form>
            </div>
            <div className="max-h-[70vh] overflow-y-auto divide-y divide-lt-hairline">
              {jobs === null && <div className="p-4 text-[12px] text-lt-fg3">Loading…</div>}
              {jobs?.length === 0 && <div className="p-4 text-[12px] text-lt-fg3">No jobs match.</div>}
              {jobs?.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setSelected(j.id)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-lt-inner ${selected === j.id ? 'bg-lt-inner' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-lt-fg2">{j.jobCode}</span>
                    {j.linkedOrders.length > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {j.linkedOrders.length} linked
                      </span>
                    )}
                    {!j.companyRwLinked && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200" title="Client has no RW customer — no suggestions possible">
                        no RW client
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] font-semibold text-lt-fg truncate">{j.name}</div>
                  <div className="text-[11px] text-lt-fg3 truncate">
                    {j.company?.name || '—'} · {fmt(j.startDate)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Right: the evidence + the candidates ── */}
          {selected ? <ReconcilePanel jobId={selected} onLinked={loadJobs} /> : (
            <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-[13px] text-lt-fg3">
              Pick a job on the left.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReconcilePanel({ jobId, onLinked }: { jobId: string; onLinked: () => void }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [rw, setRw] = useState<RwData | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch(`/api/jobs/${jobId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/jobs/${jobId}/rw-orders`).then((r) => (r.ok ? r.json() : null)),
    ]);
    setJob(a?.job ?? null);
    setRw(b ?? null);
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const link = async (orderNumber: string) => {
    if (!orderNumber.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/jobs/${jobId}/rw-orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rwOrderNumber: orderNumber.trim() }),
      });
      setManual('');
      await load();
      onLinked();
    } finally { setBusy(false); }
  };

  const unlink = async (orderNumber: string) => {
    setBusy(true);
    try {
      await fetch(`/api/jobs/${jobId}/rw-orders?orderNumber=${encodeURIComponent(orderNumber)}`, { method: 'DELETE' });
      await load();
      onLinked();
    } finally { setBusy(false); }
  };

  if (!job) return <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-[13px] text-lt-fg3">Loading job…</div>;

  const assets = [...new Set((job.bookings || []).flatMap((b) => b.items.flatMap((i) => i.assignments.map((a) => a.asset.unitName))))];
  const lineItems = (job.orders || []).flatMap((o) => o.lineItems.map((li) => li.description)).slice(0, 12);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      {/* Evidence */}
      <div className="space-y-4">
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-mono text-[12px] text-lt-fg2">{job.jobCode}</span>
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-lt-inner border border-lt-hairline text-lt-fg2">{job.status}</span>
            <Link href={`/jobs/${jobId}`} className="ml-auto text-[11px] font-semibold text-blue-700 hover:underline">Open job →</Link>
          </div>
          <h2 className="text-lg font-bold text-lt-fg">{job.name}</h2>
          <div className="text-[13px] text-lt-fg2">
            <Link href={`/crm/${job.company.id}`} className="font-semibold hover:underline">{job.company.name}</Link>
            {' · '}{fmt(job.startDate)} – {fmt(job.endDate)}
            {job.agent && <> · {job.agent.name}</>}
          </div>

          {job.jobContacts?.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold mb-1">Contacts</div>
              <div className="space-y-0.5">
                {job.jobContacts.map((c) => (
                  <div key={c.id} className="text-[12px] text-lt-fg2">
                    <span className="text-lt-fg font-medium">{c.person.firstName} {c.person.lastName}</span>
                    {c.isPrimary && <span className="ml-1.5 text-[9px] font-bold text-amber-600 uppercase">Primary</span>}
                    {c.person.email && <> · {c.person.email}</>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(assets.length > 0 || lineItems.length > 0) && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold mb-1">What they rented</div>
              <div className="text-[12px] text-lt-fg2">
                {assets.length > 0 && <div>Units: {assets.join(', ')}</div>}
                {lineItems.length > 0 && <div className="text-lt-fg3">{lineItems.join(' · ')}</div>}
              </div>
            </div>
          )}

          {job.notes && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold mb-1">Job notes</div>
              <div className="text-[12px] text-lt-fg2 whitespace-pre-wrap">{job.notes}</div>
            </div>
          )}
        </div>

        {/* Email trail — the strongest signal for confirming a match */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold mb-2">Email trail</div>
          <JobEmailThreads jobId={jobId} />
        </div>
      </div>

      {/* Candidates */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
        <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold mb-2">
          RentalWorks orders {rw?.companyName ? `for ${rw.companyName}` : ''}
        </div>
        {rw?.companyLinked && (
          <div className="text-[11px] text-lt-fg3 mb-2">
            Matching against job <span className="font-semibold text-lt-fg2">“{rw.jobName}”</span>
            {rw.jobAgent && <> · agent {rw.jobAgent}</>} — green ticks show why an order ranked.
          </div>
        )}

        {rw && rw.linked.length > 0 && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider mb-1">Linked</div>
            <div className="text-[13px] text-emerald-900 mb-1">
              {usd(rw.rollup.outstanding)} outstanding · {rw.rollup.openCount} of {rw.rollup.invoiceCount} invoices open
            </div>
            <div className="flex gap-2 flex-wrap">
              {rw.linked.map((l) => (
                <button
                  key={l.rwOrderNumber}
                  onClick={() => unlink(l.rwOrderNumber)}
                  disabled={busy}
                  className="text-[11px] font-mono px-2 py-0.5 rounded border border-emerald-300 bg-white text-emerald-800 hover:border-rose-300 hover:text-rose-700"
                  title="Click to unlink"
                >
                  #{l.rwOrderNumber} ✕
                </button>
              ))}
            </div>
          </div>
        )}

        {!rw?.companyLinked && (
          <div className="text-[12px] text-lt-fg3 mb-3">
            This client isn’t linked to an RW customer, so there are no suggestions — enter the order
            number directly below.
          </div>
        )}

        <div className="space-y-1.5 max-h-[52vh] overflow-y-auto">
          {rw?.candidates.map((c) => {
            const strong = c.score >= 60;
            const open = expanded === c.orderNumber;
            return (
              <div key={c.orderNumber} className={`rounded-lg border ${strong ? 'border-amber-400 bg-amber-50/50' : 'border-lt-hairline'}`}>
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setExpanded(open ? null : c.orderNumber)} className="font-mono text-[13px] text-lt-fg hover:underline">
                      #{c.orderNumber}
                    </button>
                    {c.dealName && (
                      <span className="text-[13px] font-bold text-lt-fg">{c.dealName}</span>
                    )}
                    {c.orderDescription && (
                      <span className="text-[12px] text-lt-fg2">· {c.orderDescription}</span>
                    )}
                    <button
                      onClick={() => link(c.orderNumber)}
                      disabled={busy}
                      className="ml-auto text-[11px] font-semibold px-2.5 py-1 rounded bg-lt-fg text-lt-card hover:opacity-90 disabled:opacity-40"
                    >
                      Link
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1 text-[11px] text-lt-fg3">
                    {c.agent && <span>{c.agent}</span>}
                    {(c.billingStartDate || c.billingEndDate) && (
                      <span>· rental {fmt(c.billingStartDate)} – {fmt(c.billingEndDate)}</span>
                    )}
                    <span>· {c.invoiceCount} inv · {usd(c.invoiced)}</span>
                    {c.outstanding > 0.005 && <span className="font-semibold text-amber-700">· {usd(c.outstanding)} open</span>}
                  </div>
                  {c.reasons?.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {c.reasons.map((rsn) => (
                        <span key={rsn} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                          ✓ {rsn}
                        </span>
                      ))}
                      {c.distanceDays != null && (
                        <span className="text-[10px] text-lt-fg3">{c.distanceDays}d from job start</span>
                      )}
                    </div>
                  )}
                </div>
                {open && c.invoices && c.invoices.length > 0 && (
                  <div className="border-t border-lt-hairline px-3 py-2 space-y-1">
                    {c.invoices.map((i) => (
                      <div key={i.id} className="flex items-center gap-2 flex-wrap text-[11px] text-lt-fg2">
                        <span className="font-mono text-lt-fg">#{i.invoiceNumber}</span>
                        <span>{fmt(i.invoiceDate)}</span>
                        <span>due {fmt(i.dueDate)}</span>
                        {i.poNumber && <span>PO {i.poNumber}</span>}
                        <span className="ml-auto tabular-nums">{usd(i.invoiceTotal)}</span>
                        <span className="tabular-nums font-semibold">{usd(i.remainingTotal)} left</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {rw && rw.candidates.length === 0 && rw.companyLinked && (
            <div className="text-[12px] text-lt-fg3">No unlinked RW orders for this client.</div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-lt-hairline">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Or enter an RW order number…"
            className="flex-1 px-2.5 py-1.5 bg-lt-inner border border-lt-hairline rounded-lg text-[12px] text-lt-fg focus:outline-none focus:border-lt-fg3"
          />
          <button
            onClick={() => link(manual)}
            disabled={busy || !manual.trim()}
            className="px-3 py-1.5 rounded-lg bg-lt-fg text-lt-card text-[12px] font-semibold disabled:opacity-40"
          >
            Link
          </button>
        </div>
      </div>
    </div>
  );
}
