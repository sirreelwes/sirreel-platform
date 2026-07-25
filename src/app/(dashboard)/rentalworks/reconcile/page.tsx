'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { JobEmailThreads } from '@/components/jobs/JobEmailThreads';
import { ClientRwCustomerLink } from '@/components/rentalworks/ClientRwCustomerLink';

/**
 * RentalWorks reconciliation workspace — the one place the whole matching
 * workflow lives:
 *
 *   Suggested matches (top): high-confidence job↔order pairs, one click to
 *   confirm. Everything else: pick a job, follow the two steps —
 *   Step 1 link the client to its RW customer, Step 2 link the RW order —
 *   with the evidence (client, dates, rental, email trail) beside the
 *   candidates. Linked invoices can be marked paid right here.
 *
 * Nothing links or pays automatically; suggestions only rank.
 */

type JobRow = {
  id: string; jobCode: string; name: string; status: string;
  startDate: string | null; endDate: string | null; createdAt: string;
  company: { id: string; name: string } | null;
  companyRwLinked: boolean;
  linkedOrders: string[];
};

type Suggestion = {
  jobId: string; jobCode: string; jobName: string; companyName: string;
  orderNumber: string; dealName: string | null; orderDescription: string | null;
  agent: string | null; billingStartDate: string | null; billingEndDate: string | null;
  invoiceCount: number; invoiced: number; outstanding: number;
  score: number; reasons: string[]; distanceDays: number | null;
};

type CandInv = {
  id: string; rwInvoiceId: string; invoiceNumber: string | null; status: string | null;
  invoiceDate: string | null; dueDate: string | null; poNumber: string | null;
  invoiceTotal: number; receivedTotal: number; remainingTotal: number; hqPaid: boolean;
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
  const [counts, setCounts] = useState<{ unlinked: number; linked: number; all: number } | null>(null);
  const [filter, setFilter] = useState<'unlinked' | 'linked' | 'all'>('unlinked');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to force the panel to reload
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);

  // Deep links: /rentalworks/reconcile?q=<client> pre-searches (used from
  // the invoices page's "Reconcile →" on unlinked rows).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const qq = sp.get('q');
    if (qq) { setQ(qq); setTerm(qq); }
  }, []);

  const loadJobs = useCallback(async () => {
    const p = new URLSearchParams({ filter });
    if (term) p.set('q', term);
    const r = await fetch(`/api/rentalworks/reconcile/jobs?${p}`);
    const d = r.ok ? await r.json() : { jobs: [], counts: null };
    setJobs(d.jobs);
    setCounts(d.counts ?? null);
    if (!selected && d.jobs.length) setSelected(d.jobs[0].id);
  }, [filter, term, selected]);

  const loadSuggestions = useCallback(async () => {
    const r = await fetch('/api/rentalworks/reconcile/suggestions');
    const d = r.ok ? await r.json() : { suggestions: [] };
    setSuggestions(d.suggestions ?? []);
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  const refreshAll = useCallback(() => {
    loadJobs();
    loadSuggestions();
    setVersion((v) => v + 1);
  }, [loadJobs, loadSuggestions]);

  const confirmSuggestion = async (s: Suggestion) => {
    setConfirming(s.jobId);
    try {
      await fetch(`/api/jobs/${s.jobId}/rw-orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rwOrderNumber: s.orderNumber }),
      });
      refreshAll();
    } finally { setConfirming(null); }
  };

  const visibleSuggestions = (suggestions ?? []).filter((s) => !skipped.has(s.jobId));
  const suggestedJobIds = new Set(visibleSuggestions.map((s) => s.jobId));

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1600px] mx-auto">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-lt-fg">Reconcile RentalWorks</h1>
          <p className="text-[12px] text-lt-fg3">
            Match each job to its RentalWorks order so quotes, invoices and balances follow the job.
            Nothing links automatically — you confirm every match.
          </p>
        </div>

        {/* ── Suggested matches: the one-click fast lane ── */}
        {visibleSuggestions.length > 0 && (
          <div className="mb-4 bg-lt-card border border-amber-300 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                Suggested matches
              </span>
              <span className="text-[11px] text-lt-fg3">
                high-confidence pairs — review and confirm with one click
              </span>
            </div>
            <div className="space-y-1.5">
              {visibleSuggestions.map((s) => (
                <div key={s.jobId} className="flex items-center gap-2.5 flex-wrap rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2">
                  <button onClick={() => setSelected(s.jobId)} className="text-[13px] font-semibold text-lt-fg hover:underline">
                    {s.jobCode} {s.jobName}
                  </button>
                  <span className="text-lt-fg3">↔</span>
                  <span className="font-mono text-[13px] text-lt-fg">#{s.orderNumber}</span>
                  {s.dealName && <span className="text-[13px] font-semibold text-lt-fg">{s.dealName}</span>}
                  {s.orderDescription && <span className="text-[12px] text-lt-fg2">· {s.orderDescription}</span>}
                  <span className="text-[11px] text-lt-fg3">
                    {s.companyName} · {s.invoiceCount} inv · {usd(s.invoiced)}
                    {s.outstanding > 0.005 && <span className="text-amber-700 font-semibold"> · {usd(s.outstanding)} open</span>}
                  </span>
                  <span className="flex items-center gap-1 flex-wrap">
                    {s.reasons.map((r) => (
                      <span key={r} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">✓ {r}</span>
                    ))}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={() => setSkipped((prev) => new Set(prev).add(s.jobId))}
                      className="text-[11px] text-lt-fg3 hover:text-lt-fg px-2 py-1"
                      title="Hide this suggestion for now (nothing is saved)"
                    >
                      Skip
                    </button>
                    <button
                      onClick={() => confirmSuggestion(s)}
                      disabled={confirming === s.jobId}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                    >
                      {confirming === s.jobId ? 'Linking…' : '✓ Confirm link'}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

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
                    {f}{counts ? ` (${counts[f]})` : ''}
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
                        ✓ {j.linkedOrders.length} linked
                      </span>
                    )}
                    {suggestedJobIds.has(j.id) && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-300" title="A high-confidence match is waiting in Suggested matches">
                        match?
                      </span>
                    )}
                    {!j.companyRwLinked && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200" title="Start with Step 1 — link this client to its RentalWorks customer">
                        needs client link
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] font-semibold text-lt-fg truncate">{j.name}</div>
                  <div className="text-[11px] text-lt-fg3 truncate">
                    {j.company?.name || '—'} · {j.startDate ? fmt(j.startDate) : `created ${fmt(j.createdAt)}`}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Right: the evidence + the candidates ── */}
          {selected ? (
            <ReconcilePanel key={`${selected}:${version}`} jobId={selected} onLinked={refreshAll} />
          ) : (
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

  const markPaid = async (rwInvoiceId: string, paid: boolean) => {
    setBusy(true);
    try {
      if (paid) {
        await fetch('/api/rentalworks/invoices/mark-paid', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rwInvoiceId }),
        });
      } else {
        await fetch(`/api/rentalworks/invoices/mark-paid?rwInvoiceId=${encodeURIComponent(rwInvoiceId)}`, { method: 'DELETE' });
      }
      await load();
    } finally { setBusy(false); }
  };

  if (!job) return <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-[13px] text-lt-fg3">Loading job…</div>;

  const assets = [...new Set((job.bookings || []).flatMap((b) => b.items.flatMap((i) => i.assignments.map((a) => a.asset.unitName))))];
  const lineItems = (job.orders || []).flatMap((o) => o.lineItems.map((li) => li.description)).slice(0, 12);
  const step: 1 | 2 | 3 = !rw?.companyLinked ? 1 : (rw.linked.length === 0 ? 2 : 3);

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

      {/* Candidates / stepper */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
        {/* Progress header: the two-step flow, made explicit */}
        <div className="flex items-center gap-2 mb-3 text-[11px] font-semibold">
          <span className={`px-2 py-1 rounded-lg ${step === 1 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
            {step > 1 ? '✓' : '1.'} Client linked
          </span>
          <span className="text-lt-fg3">→</span>
          <span className={`px-2 py-1 rounded-lg ${step === 2 ? 'bg-amber-100 text-amber-800' : step > 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-lt-inner text-lt-fg3'}`}>
            {step > 2 ? '✓' : '2.'} Order linked
          </span>
          <span className="text-lt-fg3">→</span>
          <span className={`px-2 py-1 rounded-lg ${step === 3 ? 'bg-emerald-50 text-emerald-700' : 'bg-lt-inner text-lt-fg3'}`}>
            Invoices &amp; balance on the job
          </span>
        </div>

        {/* STEP 1 — link the client */}
        {step === 1 && (
          <div className="mb-3">
            <div className="text-[12px] text-lt-fg2 mb-2">
              <span className="font-bold">Step 1.</span> {job.company.name} isn’t linked to a
              RentalWorks customer yet. Pick the matching RW customer — then its orders appear here.
            </div>
            <ClientRwCustomerLink companyId={job.company.id} onLinked={() => { load(); onLinked(); }} />
          </div>
        )}

        {/* Linked state — the payoff + mark-paid */}
        {rw && rw.linked.length > 0 && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Linked</div>
              <div className="flex gap-1.5 flex-wrap">
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
            <div className="text-[13px] text-emerald-900 mb-1.5">
              {usd(rw.rollup.outstanding)} outstanding · {rw.rollup.openCount} of {rw.rollup.invoiceCount} invoices open
            </div>
            {rw.invoices.length > 0 && (
              <div className="space-y-1">
                {rw.invoices.map((i) => {
                  const settled = i.hqPaid || i.remainingTotal <= 0.005;
                  return (
                    <div key={i.id} className="flex items-center gap-2 flex-wrap text-[11px] text-emerald-900 bg-white/60 rounded px-2 py-1">
                      <span className="font-mono">#{i.invoiceNumber}</span>
                      <span>{fmt(i.invoiceDate)}</span>
                      <span className="tabular-nums">{usd(i.invoiceTotal)}</span>
                      {i.hqPaid ? (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 border border-emerald-300">paid · hq</span>
                      ) : i.remainingTotal > 0.005 ? (
                        <span className="tabular-nums font-semibold text-amber-800">{usd(i.remainingTotal)} open</span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 border border-emerald-300">paid</span>
                      )}
                      <span className="ml-auto">
                        {i.hqPaid ? (
                          <button onClick={() => markPaid(i.rwInvoiceId, false)} disabled={busy} className="text-emerald-700 hover:underline">Undo</button>
                        ) : !settled ? (
                          <button onClick={() => markPaid(i.rwInvoiceId, true)} disabled={busy} className="font-semibold text-emerald-700 hover:underline">Mark paid</button>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-1.5 text-[10px] text-emerald-700">
              PDFs from RW attach on the job page → Quotes &amp; Invoices.
            </div>
          </div>
        )}

        {/* STEP 2 — pick the order */}
        {step !== 1 && (
          <>
            <div className="text-[12px] text-lt-fg2 mb-2">
              {step === 2 && <span className="font-bold">Step 2. </span>}
              {rw?.companyName}’s RentalWorks orders, best match first — matching against{' '}
              <span className="font-semibold">“{rw?.jobName}”</span>
              {rw?.jobAgent && <> · agent {rw.jobAgent}</>}. Green ticks show why an order ranked.
            </div>

            <div className="space-y-1.5 max-h-[48vh] overflow-y-auto">
              {rw?.candidates.map((c) => {
                const strong = c.score >= 60;
                const open = expanded === c.orderNumber;
                return (
                  <div key={c.orderNumber} className={`rounded-lg border ${strong ? 'border-amber-400 bg-amber-50/50' : 'border-lt-hairline'}`}>
                    <div className="px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setExpanded(open ? null : c.orderNumber)} className="font-mono text-[13px] text-lt-fg hover:underline" title="Show this order's invoices">
                          #{c.orderNumber} {open ? '▾' : '▸'}
                        </button>
                        {c.dealName && <span className="text-[13px] font-bold text-lt-fg">{c.dealName}</span>}
                        {c.orderDescription && <span className="text-[12px] text-lt-fg2">· {c.orderDescription}</span>}
                        <button
                          onClick={() => link(c.orderNumber)}
                          disabled={busy}
                          className="ml-auto text-[11px] font-semibold px-2.5 py-1 rounded bg-lt-fg text-lt-card hover:opacity-90 disabled:opacity-40"
                        >
                          Link to this job
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
                <div className="text-[12px] text-lt-fg3">
                  No unlinked RW orders for this client — every order is already linked to a job, or
                  RW has nothing for them yet.
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-lt-hairline">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Know the RW order number? Enter it…"
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
          </>
        )}
      </div>
    </div>
  );
}
