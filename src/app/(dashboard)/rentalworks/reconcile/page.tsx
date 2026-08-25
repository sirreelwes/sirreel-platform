'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { JobEmailThreads } from '@/components/jobs/JobEmailThreads';
import { ClientRwCustomerLink } from '@/components/rentalworks/ClientRwCustomerLink';
import { SurfaceGuard } from '@/components/shared/SurfaceGuard';

/**
 * RentalWorks reconciliation workspace.
 *
 * The queue is bucketed by what you can DO, because a flat "unlinked" list
 * was misleading — most unlinked jobs were blocked on a client link or had
 * no RW counterpart at all, so the count never dropped and nothing felt
 * finished. Now: Ready to match is the real work, and jobs with no RW
 * counterpart can be dismissed so the queue reaches zero.
 *
 * Linking still requires a human click — mis-linking attributes real money
 * to the wrong job — but everything around that click is one keystroke.
 */

type Bucket = 'ready' | 'needsClient' | 'noMatch' | 'dismissed' | 'linked';

type JobRow = {
  id: string; jobCode: string; name: string; status: string;
  startDate: string | null; endDate: string | null; createdAt: string;
  company: { id: string; name: string } | null;
  companyRwLinked: boolean;
  linkedOrders: string[];
  bucket: Bucket;
  candidateCount: number;
};

type Counts = Record<Bucket, number>;

type Suggestion = {
  jobId: string; jobCode: string; jobName: string; companyName: string;
  orderNumber: string; dealName: string | null; orderDescription: string | null;
  agent: string | null; billingStartDate: string | null; billingEndDate: string | null;
  invoiceCount: number; invoiced: number; outstanding: number;
  source?: 'invoice' | 'quote';
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

/**
 * Calendar dates (pickup, return, due) — UTC, never local.
 *
 * Separate from fmt() on purpose: that one also renders INSTANTS
 * (createdAt, signedAt, …) where local time is correct. Pinning it to UTC
 * would fix the rental dates and break the timestamps. See
 * src/lib/dates/calendarDate.ts.
 */
function fmtDay(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { ...{ month: 'short', day: 'numeric', year: 'numeric' }, timeZone: 'UTC' })
}

const fmt = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const TABS: Array<{ key: Bucket; label: string; hint: string }> = [
  { key: 'ready', label: 'Ready to match', hint: 'RW orders are waiting for these' },
  { key: 'needsClient', label: 'Needs client link', hint: 'Link the client to a RentalWorks customer first' },
  { key: 'noMatch', label: 'No RW orders', hint: 'Client is linked but has no unclaimed orders left' },
  { key: 'dismissed', label: 'Not in RW', hint: 'Marked as having no RentalWorks counterpart' },
  { key: 'linked', label: 'Linked', hint: 'Done' },
];

/**
 * Age of the RentalWorks mirror.
 *
 * Amber past a day, red past two: the sync is nightly, so a larger gap means
 * it stopped running. This page had NO staleness signal at all, while the
 * sync was failing for over two weeks — so every match suggestion was
 * computed from balances frozen in July with nothing on screen saying so.
 */
function RwSyncAge({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-[11px] text-red-500">RW balances never synced</span>;
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  const label = hours < 1 ? 'just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
  const cls = hours >= 48 ? 'text-red-500 font-semibold' : hours >= 24 ? 'text-amber-600' : 'text-lt-fg3';
  return (
    <span className={`text-[11px] ${cls}`} title={new Date(iso).toLocaleString()}>
      RW data as of {label}{hours >= 48 ? ' — sync is behind' : ''}
    </span>
  );
}

function ReconcilePageInner() {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [bucket, setBucket] = useState<Bucket>('ready');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  // Age of the RW mirror the suggestions are computed from. Reconcile matches
  // jobs to orders on invoice evidence, so stale input produces
  // confident-looking matches against invoices that may already be settled.
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2600); };

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const qq = sp.get('q');
    if (qq) { setQ(qq); setTerm(qq); setBucket('ready'); }
  }, []);

  const loadJobs = useCallback(async () => {
    const p = new URLSearchParams({ bucket });
    if (term) p.set('q', term);
    const r = await fetch(`/api/rentalworks/reconcile/jobs?${p}`);
    const d = r.ok ? await r.json() : { jobs: [], counts: null };
    setJobs(d.jobs);
    setCounts(d.counts ?? null);
    return d.jobs as JobRow[];
  }, [bucket, term]);

  const loadSuggestions = useCallback(async () => {
    const r = await fetch('/api/rentalworks/reconcile/suggestions');
    const d = r.ok ? await r.json() : { suggestions: [] };
    setSuggestions(d.suggestions ?? []);
    setSyncedAt(d.syncedAt ?? null);
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  // Keep a selection inside the current list; default to the first job.
  useEffect(() => {
    if (!jobs) return;
    if (!jobs.length) { setSelected(null); return; }
    if (!selected || !jobs.some((j) => j.id === selected)) setSelected(jobs[0].id);
  }, [jobs, selected]);

  /** After finishing a job, drop it from the list and land on the next one. */
  const advancePast = useCallback((jobId: string) => {
    setJobs((prev) => {
      if (!prev) return prev;
      const idx = prev.findIndex((j) => j.id === jobId);
      const next = prev.filter((j) => j.id !== jobId);
      if (idx >= 0) setSelected(next[Math.min(idx, next.length - 1)]?.id ?? null);
      return next;
    });
    setVersion((v) => v + 1);
    loadSuggestions();
    // Refresh counts in the background without yanking the list out from under.
    fetch(`/api/rentalworks/reconcile/jobs?bucket=${bucket}${term ? `&q=${encodeURIComponent(term)}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.counts && setCounts(d.counts))
      .catch(() => {});
  }, [bucket, term, loadSuggestions]);

  const dismissJobs = async (jobIds: string[], notApplicable = true) => {
    if (!jobIds.length) return;
    setBulkBusy(true);
    try {
      await fetch('/api/rentalworks/reconcile/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds, notApplicable }),
      });
      flash(notApplicable
        ? `${jobIds.length} job${jobIds.length > 1 ? 's' : ''} marked “not in RentalWorks”`
        : 'Job returned to the queue');
      if (jobIds.length === 1) advancePast(jobIds[0]);
      else { await loadJobs(); loadSuggestions(); }
    } finally { setBulkBusy(false); }
  };

  const confirmSuggestion = async (s: Suggestion) => {
    setConfirming(s.jobId);
    try {
      await fetch(`/api/jobs/${s.jobId}/rw-orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rwOrderNumber: s.orderNumber }),
      });
      flash(`${s.jobCode} linked to #${s.orderNumber}`);
      setSuggestions((prev) => (prev ?? []).filter((x) => x.jobId !== s.jobId));
      advancePast(s.jobId);
    } finally { setConfirming(null); }
  };

  const confirmAll = async () => {
    const list = visibleSuggestions;
    if (!list.length) return;
    if (!window.confirm(`Link all ${list.length} suggested matches?\n\nEach is a high-confidence pair. You can unlink any of them afterwards.`)) return;
    setBulkBusy(true);
    try {
      for (const s of list) {
        await fetch(`/api/jobs/${s.jobId}/rw-orders`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rwOrderNumber: s.orderNumber }),
        });
      }
      flash(`${list.length} matches linked`);
      await loadJobs();
      await loadSuggestions();
      setVersion((v) => v + 1);
    } finally { setBulkBusy(false); }
  };

  const visibleSuggestions = useMemo(
    () => (suggestions ?? []).filter((s) => !skipped.has(s.jobId)),
    [suggestions, skipped],
  );
  const suggestedJobIds = useMemo(() => new Set(visibleSuggestions.map((s) => s.jobId)), [visibleSuggestions]);

  // Keyboard: J/K (or ↑/↓) move through the queue, D dismisses. Linking stays
  // an explicit click — a stray keystroke must never attribute money.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!jobs?.length) return;
      const idx = jobs.findIndex((j) => j.id === selected);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected(jobs[Math.min(idx + 1, jobs.length - 1)]?.id ?? null);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected(jobs[Math.max(idx - 1, 0)]?.id ?? null);
      } else if (e.key === 'd' && selected && bucket !== 'dismissed' && bucket !== 'linked') {
        e.preventDefault();
        dismissJobs([selected]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, selected, bucket]);

  const totalOpen = counts ? counts.ready + counts.needsClient + counts.noMatch : 0;

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1600px] mx-auto">
        {toast && (
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-lt-fg text-lt-card text-[13px] font-semibold px-4 py-2 rounded-lg shadow-xl">
            {toast}
          </div>
        )}

        <div className="mb-4 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-lt-fg">Reconcile RentalWorks</h1>
            <RwSyncAge iso={syncedAt} />
            <p className="text-[12px] text-lt-fg3">
              {counts
                ? counts.ready > 0
                  ? <><span className="font-semibold text-lt-fg2">{counts.ready} job{counts.ready === 1 ? '' : 's'} ready to match</span> — {totalOpen} unlinked in total.</>
                  : <>Nothing ready to match right now — {counts.needsClient} need a client link.</>
                : 'Loading…'}
            </p>
          </div>
          <span className="text-[11px] text-lt-fg3">
            <kbd className="px-1 py-0.5 rounded border border-lt-hairline bg-lt-card font-mono">J</kbd>/
            <kbd className="px-1 py-0.5 rounded border border-lt-hairline bg-lt-card font-mono">K</kbd> move ·{' '}
            <kbd className="px-1 py-0.5 rounded border border-lt-hairline bg-lt-card font-mono">D</kbd> not in RW
          </span>
        </div>

        {/* ── Suggested matches ── */}
        {visibleSuggestions.length > 0 && (
          <div className="mb-4 bg-lt-card border border-amber-300 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                Suggested matches ({visibleSuggestions.length})
              </span>
              <span className="text-[11px] text-lt-fg3">high-confidence pairs — confirm with one click</span>
              <button
                onClick={confirmAll}
                disabled={bulkBusy}
                className="ml-auto text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              >
                {bulkBusy ? 'Working…' : `✓ Confirm all ${visibleSuggestions.length}`}
              </button>
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
                  {s.source === 'quote' && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200"
                      title="From the RW quote mirror — no invoices yet. Linking now means every future invoice on this number rolls up automatically."
                    >
                      QUOTE · pre-invoice
                    </span>
                  )}
                  <span className="text-[11px] text-lt-fg3">
                    {s.companyName}
                    {s.source === 'quote'
                      ? <> · quoted {usd(s.invoiced)}</>
                      : <> · {s.invoiceCount} inv · {usd(s.invoiced)}</>}
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
                      title="Hide this suggestion for now"
                    >
                      Skip
                    </button>
                    <button
                      onClick={() => confirmSuggestion(s)}
                      disabled={confirming === s.jobId || bulkBusy}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                    >
                      {confirming === s.jobId ? 'Linking…' : '✓ Confirm'}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Bucket tabs ── */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {TABS.map((t) => {
            const n = counts?.[t.key] ?? 0;
            const active = bucket === t.key;
            return (
              <button
                key={t.key}
                onClick={() => { setBucket(t.key); setSelected(null); }}
                title={t.hint}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                  active ? 'bg-lt-fg text-lt-card border-lt-fg'
                  : n === 0 ? 'bg-lt-card text-lt-fg3 border-lt-hairline'
                  : 'bg-lt-card text-lt-fg2 border-lt-hairline hover:text-lt-fg'
                }`}
              >
                {t.label} <span className={active ? 'opacity-80' : 'opacity-60'}>({n})</span>
              </button>
            );
          })}
          <form
            onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}
            className="flex items-center gap-2 ml-auto"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Job or client…"
              className="px-3 py-1.5 w-60 bg-lt-card border border-lt-hairline rounded-lg text-[12px] text-lt-fg focus:outline-none focus:border-lt-fg3"
            />
            {term && (
              <button type="button" onClick={() => { setQ(''); setTerm(''); }} className="text-[12px] text-lt-fg3 hover:text-lt-fg">
                Clear
              </button>
            )}
          </form>
        </div>

        {/* Bucket-level guidance + bulk action */}
        {bucket === 'noMatch' && (jobs?.length ?? 0) > 0 && (
          <div className="mb-3 flex items-center gap-3 flex-wrap rounded-xl border border-lt-hairline bg-lt-card px-4 py-2.5">
            <span className="text-[12px] text-lt-fg2">
              These clients are linked to RentalWorks but have no unclaimed orders left — usually HQ-native
              work that was never billed through RW.
            </span>
            <button
              onClick={() => dismissJobs((jobs ?? []).map((j) => j.id))}
              disabled={bulkBusy}
              className="ml-auto text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-lt-hairline bg-lt-inner text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
            >
              Mark all {jobs?.length} “not in RentalWorks”
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
          {/* ── Queue ── */}
          <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
            <div className="max-h-[72vh] overflow-y-auto divide-y divide-lt-hairline">
              {jobs === null && <div className="p-4 text-[12px] text-lt-fg3">Loading…</div>}
              {jobs?.length === 0 && (
                <div className="p-5 text-[12px] text-lt-fg3">
                  {bucket === 'ready'
                    ? '🎉 Nothing left to match. New RentalWorks orders will show up here after the nightly sync.'
                    : bucket === 'needsClient'
                      ? 'Every client is linked to a RentalWorks customer.'
                      : bucket === 'noMatch'
                        ? 'Nothing here.'
                        : bucket === 'dismissed'
                          ? 'No jobs have been marked “not in RentalWorks”.'
                          : 'No jobs linked yet.'}
                </div>
              )}
              {jobs?.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setSelected(j.id)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-lt-inner ${selected === j.id ? 'bg-lt-inner border-l-2 border-l-lt-fg' : 'border-l-2 border-l-transparent'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-lt-fg2">{j.jobCode}</span>
                    {j.linkedOrders.length > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ✓ {j.linkedOrders.length}
                      </span>
                    )}
                    {suggestedJobIds.has(j.id) && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-300">
                        suggested
                      </span>
                    )}
                    {j.bucket === 'ready' && !suggestedJobIds.has(j.id) && (
                      <span className="text-[9px] text-lt-fg3">{j.candidateCount} candidate{j.candidateCount === 1 ? '' : 's'}</span>
                    )}
                    {j.bucket === 'dismissed' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">not in RW</span>
                    )}
                  </div>
                  <div className="text-[13px] font-semibold text-lt-fg truncate">{j.name}</div>
                  <div className="text-[11px] text-lt-fg3 truncate">
                    {j.company?.name || '—'} · {j.startDate ? fmtDay(j.startDate) : `created ${fmt(j.createdAt)}`}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Detail ── */}
          {selected ? (
            <ReconcilePanel
              key={`${selected}:${version}`}
              jobId={selected}
              bucket={bucket}
              onLinked={() => advancePast(selected)}
              onDismiss={() => dismissJobs([selected])}
              onRestore={() => dismissJobs([selected], false)}
              onClientLinked={() => { loadJobs(); loadSuggestions(); setVersion((v) => v + 1); }}
            />
          ) : (
            <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-[13px] text-lt-fg3">
              {jobs?.length ? 'Pick a job on the left.' : 'Nothing to do in this bucket.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReconcilePanel({
  jobId, bucket, onLinked, onDismiss, onRestore, onClientLinked,
}: {
  jobId: string;
  bucket: Bucket;
  onLinked: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  onClientLinked: () => void;
}) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [rw, setRw] = useState<RwData | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAllCands, setShowAllCands] = useState(false);

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
      onLinked();
    } finally { setBusy(false); }
  };

  const unlink = async (orderNumber: string) => {
    setBusy(true);
    try {
      await fetch(`/api/jobs/${jobId}/rw-orders?orderNumber=${encodeURIComponent(orderNumber)}`, { method: 'DELETE' });
      await load();
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
  const cands = rw?.candidates ?? [];
  const strongCands = cands.filter((c) => c.score >= 60);
  const shownCands = showAllCands ? cands : (strongCands.length ? strongCands : cands.slice(0, 6));

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
            {' · '}{fmtDay(job.startDate)} – {fmtDay(job.endDate)}
            {job.agent && <> · {job.agent.name}</>}
          </div>

          {job.jobContacts?.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold mb-1">Contacts</div>
              {job.jobContacts.map((c) => (
                <div key={c.id} className="text-[12px] text-lt-fg2">
                  <span className="text-lt-fg font-medium">{c.person.firstName} {c.person.lastName}</span>
                  {c.isPrimary && <span className="ml-1.5 text-[9px] font-bold text-amber-600 uppercase">Primary</span>}
                  {c.person.email && <> · {c.person.email}</>}
                </div>
              ))}
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

          {/* Escape hatch — always available, always reversible */}
          <div className="mt-3 pt-3 border-t border-lt-hairline">
            {bucket === 'dismissed' ? (
              <button onClick={onRestore} disabled={busy} className="text-[11px] font-semibold text-lt-fg2 hover:text-lt-fg">
                ↩︎ Put back in the queue
              </button>
            ) : (
              <button
                onClick={onDismiss}
                disabled={busy}
                className="text-[11px] text-lt-fg3 hover:text-lt-fg"
                title="This job has no RentalWorks counterpart (press D)"
              >
                This job isn’t in RentalWorks — remove it from the queue
              </button>
            )}
          </div>
        </div>

        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold mb-2">Email trail</div>
          <JobEmailThreads jobId={jobId} />
        </div>
      </div>

      {/* Action side */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
        {/* Linked state */}
        {rw && rw.linked.length > 0 && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Linked</div>
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
            <div className="text-[13px] text-emerald-900 mb-1.5">
              {usd(rw.rollup.outstanding)} outstanding · {rw.rollup.openCount} of {rw.rollup.invoiceCount} invoices open
            </div>
            {rw.invoices.map((i) => (
              <div key={i.id} className="flex items-center gap-2 flex-wrap text-[11px] text-emerald-900 bg-white/60 rounded px-2 py-1 mb-1">
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
                <span className="ml-auto flex items-center gap-2">
                  <a href={`/api/rentalworks/invoices/${i.rwInvoiceId}/pdf`} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 hover:underline">PDF</a>
                  {i.hqPaid ? (
                    <button onClick={() => markPaid(i.rwInvoiceId, false)} disabled={busy} className="text-emerald-700 hover:underline">Undo</button>
                  ) : i.remainingTotal > 0.005 ? (
                    <button onClick={() => markPaid(i.rwInvoiceId, true)} disabled={busy} className="font-semibold text-emerald-700 hover:underline">Mark paid</button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Needs client link */}
        {!rw?.companyLinked ? (
          <div>
            <div className="text-[12px] text-lt-fg2 mb-2">
              <span className="font-bold">{job.company.name}</span> isn’t linked to a RentalWorks customer.
              Link it and this client’s orders appear here — for this job and every other one.
            </div>
            <ClientRwCustomerLink companyId={job.company.id} onLinked={() => { load(); onClientLinked(); }} />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[12px] text-lt-fg2">
                {cands.length > 0
                  ? <>Best matches for <span className="font-semibold">“{rw?.jobName}”</span>{rw?.jobAgent && <> · {rw.jobAgent}</>}</>
                  : 'No unclaimed RentalWorks orders left for this client.'}
              </span>
              {cands.length > shownCands.length && (
                <button onClick={() => setShowAllCands(true)} className="text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg">
                  Show all {cands.length}
                </button>
              )}
            </div>

            <div className="space-y-1.5 max-h-[46vh] overflow-y-auto">
              {shownCands.map((c) => {
                const strong = c.score >= 60;
                const open = expanded === c.orderNumber;
                return (
                  <div key={c.orderNumber} className={`rounded-lg border ${strong ? 'border-amber-400 bg-amber-50/50' : 'border-lt-hairline'}`}>
                    <div className="px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setExpanded(open ? null : c.orderNumber)} className="font-mono text-[13px] text-lt-fg hover:underline">
                          #{c.orderNumber} {open ? '▾' : '▸'}
                        </button>
                        {c.dealName && <span className="text-[13px] font-bold text-lt-fg">{c.dealName}</span>}
                        {c.orderDescription && <span className="text-[12px] text-lt-fg2">· {c.orderDescription}</span>}
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
                        {(c.billingStartDate || c.billingEndDate) && <span>· rental {fmt(c.billingStartDate)} – {fmt(c.billingEndDate)}</span>}
                        <span>· {c.invoiceCount} inv · {usd(c.invoiced)}</span>
                        {c.outstanding > 0.005 && <span className="font-semibold text-amber-700">· {usd(c.outstanding)} open</span>}
                      </div>
                      {c.reasons?.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                          {c.reasons.map((rsn) => (
                            <span key={rsn} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">✓ {rsn}</span>
                          ))}
                          {c.distanceDays != null && <span className="text-[10px] text-lt-fg3">{c.distanceDays}d from job start</span>}
                        </div>
                      )}
                    </div>
                    {open && c.invoices && c.invoices.length > 0 && (
                      <div className="border-t border-lt-hairline px-3 py-2 space-y-1">
                        {c.invoices.map((i) => (
                          <div key={i.id} className="flex items-center gap-2 flex-wrap text-[11px] text-lt-fg2">
                            <span className="font-mono text-lt-fg">#{i.invoiceNumber}</span>
                            <span>{fmt(i.invoiceDate)}</span>
                            {i.poNumber && <span>PO {i.poNumber}</span>}
                            <span className="ml-auto tabular-nums">{usd(i.invoiceTotal)}</span>
                            <a href={`/api/rentalworks/invoices/${i.rwInvoiceId}/pdf`} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">PDF</a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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

// Page-level guard (Wes 2026-08-24): a clean explanation instead of an
// empty skeleton when someone reaches this by URL. Cosmetic only — the
// APIs behind this page already refuse the same roles.
export default function ReconcilePage() {
  return (
    <SurfaceGuard need="billing" label="RentalWorks reconcile">
      <ReconcilePageInner />
    </SurfaceGuard>
  );
}
