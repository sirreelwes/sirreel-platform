'use client';

/**
 * Quick Reply — a fast availability-confirmation reply for an inbound client
 * email asking to hold trucks/supplies before a firm quote.
 *
 * Reuses the Capture & Quote spine end-to-end:
 *   1. parse the email via the SAME parser (POST /api/orders/parse-quote)
 *   2. real per-category availability (POST /api/sales/quick-reply/availability
 *      → getCategoryAvailability) — the reply text is built FROM these numbers
 *   3. optional soft holds via the SAME hold path (POST /api/scheduling/holds)
 *   4. review + send through the SAME gate (EmailReviewModal) — nothing auto-sends
 *
 * Job-as-root (step 4): soft holds no longer auto-create a Job. Before
 * any hold is created, the JobResolverModal opens — seeded with the
 * parsed company/contact/name/dates — and the agent explicitly picks an
 * existing Job or creates one (createJobFromDraft, status NEW). A second
 * email about the same shoot ranks the first email's Job as a candidate
 * instead of silently spawning a duplicate.
 */

import { useCallback, useEffect, useState } from 'react';
import { EmailReviewModal, type EmailReviewTarget } from '@/components/email/EmailReviewModal';
import { JobResolverModal, type ResolvedJob } from '@/components/shared/JobResolverModal';

interface MatchedProduct { id: string; type: string; name: string }
interface ParsedItem { catalogType: string | null; quantity: number; matchedProduct: MatchedProduct | null }
interface Cat { id: string; name: string; quantity: number }
interface Line { id: string; name: string; requested: number; availableToHold: number; serviceableCount: number; status: 'available' | 'tight' | 'short' }

interface Props {
  emailText: string;
  defaultRecipientEmail?: string | null;
  defaultRecipientName?: string | null;
  /** EmailMessage id of the inbound being replied to — drives CRM capture on send. */
  inboundEmailMessageId?: string | null;
  /** EmailThread id (email-in-Job) — feeds resolver rung ① (a thread
   *  already filed in a Job is a CLEAN_MATCH) and lets the resolved Job
   *  auto-file the thread (fill-only) after the agent's pick. */
  threadId?: string | null;
  onClose: () => void;
  onSent?: () => void;
}

const STATUS_PILL: Record<Line['status'], string> = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  tight: 'bg-amber-50 text-amber-800 border-amber-200',
  short: 'bg-rose-50 text-rose-700 border-rose-200',
};
const STATUS_LABEL: Record<Line['status'], string> = { available: 'Available', tight: 'Tight', short: 'Spoken for' };

export function QuickReplyModal({ emailText, defaultRecipientEmail, defaultRecipientName, inboundEmailMessageId, threadId, onClose, onSent }: Props) {
  const [phase, setPhase] = useState<'parsing' | 'ready' | 'error'>('parsing');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [clientName, setClientName] = useState<string | null>(null);
  const [jobName, setJobName] = useState<string | null>(null);
  const [pickup, setPickup] = useState<string | null>(null);
  const [ret, setRet] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [holdable, setHoldable] = useState<{ companyId: string; personId: string } | null>(null);

  const [softHold, setSoftHold] = useState(true);
  // The resolved Job the soft holds will live in — always a REAL row
  // (agent-picked or agent-created via the resolver). Never auto-set.
  const [job, setJob] = useState<{ jobId: string; jobCode: string; name: string } | null>(null);
  const [resolverOpen, setResolverOpen] = useState(false);
  // Fold a request for the prod company + project name into the reply.
  // Default ON when the parse gave us neither — that's the "missing info" case.
  const [askForDetails, setAskForDetails] = useState(false);
  const [holdStatus, setHoldStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<EmailReviewTarget | null>(null);

  const run = useCallback(async () => {
    setPhase('parsing');
    setErrMsg(null);
    try {
      const pr = await fetch('/api/orders/parse-quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: emailText }),
      });
      const pj = await pr.json();
      if (!pr.ok) throw new Error(pj.error || `Parse failed (${pr.status})`);

      const parsed = pj.parsed || {};
      const items: ParsedItem[] = Array.isArray(pj.items) ? pj.items : [];
      const assetCats: Cat[] = items
        .filter((i) => i.catalogType === 'ASSET_CATEGORY' && i.matchedProduct)
        .map((i) => ({ id: i.matchedProduct!.id, name: i.matchedProduct!.name, quantity: Math.max(1, Math.floor(i.quantity || 1)) }));

      setClientName(parsed.clientName ?? null);
      setJobName(parsed.productionName ?? null);
      // Default the "ask the client" toggle ON when we have neither the
      // production company nor a job name — the reply will request them.
      setAskForDetails(!(parsed.clientName || parsed.productionName));
      setPickup(parsed.startDate ?? null);
      setRet(parsed.endDate ?? null);
      setRecipientEmail(parsed.contactEmail ?? defaultRecipientEmail ?? null);
      setRecipientName(parsed.contactName ?? defaultRecipientName ?? null);
      setCats(assetCats);

      // Soft-hold needs an existing company + person (the parse resolves both
      // when the client is already in the CRM). Otherwise it's skipped.
      // Only an EXACT key match is adopted (clientMatchMeta.exact) —
      // fuzzy candidates are never blind-picked; the Job resolver is
      // where the agent settles company questions.
      const companyId: string | null =
        pj.clientMatchMeta?.exact === true && Array.isArray(pj.clientMatch) && pj.clientMatch[0]?.id
          ? pj.clientMatch[0].id
          : null;
      const contact = Array.isArray(pj.contacts) ? pj.contacts.find((c: { existing_person_id?: string | null }) => c.existing_person_id) : null;
      const personId: string | null = contact?.existing_person_id ?? null;
      const canHold = !!companyId && !!personId && assetCats.length > 0 && !!parsed.startDate && !!parsed.endDate;
      setHoldable(canHold ? { companyId: companyId!, personId: personId! } : null);
      if (!canHold) setSoftHold(false);

      // Real availability per category.
      if (assetCats.length > 0) {
        const ar = await fetch('/api/sales/quick-reply/availability', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories: assetCats, pickup: parsed.startDate, return: parsed.endDate }),
        });
        const aj = await ar.json();
        if (ar.ok && aj.ok) setLines(aj.lines || []);
      }
      setPhase('ready');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [emailText, defaultRecipientEmail, defaultRecipientName]);

  useEffect(() => { run(); }, [run]);

  const buildPayload = () => ({
    recipientEmail: recipientEmail!,
    recipientName,
    clientName: clientName?.trim() || null,
    jobName: jobName?.trim() || null,
    pickup,
    return: ret,
    categories: cats,
    askForDetails,
    inboundEmailMessageId: inboundEmailMessageId ?? null,
  });

  // Every hold attaches to the agent-resolved Job — the route's inline
  // newJobName creation is gone; jobId is always real by this point.
  // companyId is passed explicitly (not read from state) so a resolve
  // that just re-pointed the company isn't lost to a stale closure.
  const createSoftHolds = async (resolved: { jobId: string; name: string }, companyId: string) => {
    if (!holdable) return;
    setHoldStatus('Creating soft holds…');
    let created = 0;
    for (const c of cats) {
      const line = lines.find((l) => l.id === c.id);
      const isBackup = !!line && line.status !== 'available'; // tight/short queue behind as backups
      const body: Record<string, unknown> = {
        categoryId: c.id, startDate: pickup, endDate: ret, quantity: c.quantity,
        companyId, personId: holdable.personId,
        jobId: resolved.jobId, jobName: resolved.name,
        bufferDays: 1, bufferOverride: true, isBackup,
        notes: 'Soft hold from Quick Reply — pending client confirmation.',
      };
      try {
        const r = await fetch('/api/scheduling/holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json();
        if (r.ok && j.ok) created++;
      } catch { /* best-effort; reported in the count */ }
    }
    setHoldStatus(`Created ${created} of ${cats.length} soft hold${cats.length === 1 ? '' : 's'} — spoken-for on the gantt.`);
  };

  const proceed = async (resolved: { jobId: string; name: string } | null, companyId: string | null) => {
    setWorking(true);
    if (softHold && holdable && resolved) await createSoftHolds(resolved, companyId ?? holdable.companyId);
    setReviewTarget({ kind: 'quick-reply', payload: buildPayload() });
    setWorking(false);
  };

  const reviewAndSend = () => {
    if (!recipientEmail) return;
    // Soft holds need a Job (Job-as-root). If the agent hasn't resolved
    // one yet, open the resolver — the send continues from onJobResolved.
    if (softHold && holdable && !job) {
      setResolverOpen(true);
      return;
    }
    void proceed(job, holdable?.companyId ?? null);
  };

  const onJobResolved = (r: ResolvedJob) => {
    const resolved = { jobId: r.id, jobCode: r.jobCode, name: r.name };
    setJob(resolved);
    // The Job is the root object: if the agent attached to a Job under a
    // different company, the holds follow the Job's company (the holds
    // route rejects a job/company mismatch).
    const companyId = r.companyId ?? holdable?.companyId ?? null;
    if (holdable && companyId && holdable.companyId !== companyId) {
      setHoldable({ ...holdable, companyId });
    }
    // Keep the reply copy in sync with the Job the holds actually live in.
    setJobName(r.name);
    // Email-in-Job: file this thread in the resolved Job (fill-only —
    // a thread an operator already filed elsewhere is left alone).
    if (threadId) {
      void fetch(`/api/email-threads/${encodeURIComponent(threadId)}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: r.id, onlyIfUnfiled: true }),
      }).catch(() => {});
    }
    setResolverOpen(false);
    void proceed(resolved, companyId);
  };

  if (resolverOpen) {
    return (
      <JobResolverModal
        context={{
          companyId: holdable?.companyId ?? null,
          companyName: clientName?.trim() || null,
          contactEmail: recipientEmail || null,
          contactName: recipientName || null,
          jobNameHint: jobName?.trim() || null,
          dates: pickup && ret ? { start: pickup.slice(0, 10), end: ret.slice(0, 10) } : null,
          threadId: threadId ?? null,
          sourceRef: 'sales:quick-reply',
        }}
        onResolved={onJobResolved}
        onClose={() => setResolverOpen(false)}
      />
    );
  }

  if (reviewTarget) {
    return (
      <EmailReviewModal
        target={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onSent={() => { onSent?.(); onClose(); }}
      />
    );
  }

  const fmt = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between px-5 py-3.5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Quick Reply</h2>
            <p className="text-[11px] text-gray-400">Confirm availability &amp; reply — no quote yet</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {phase === 'parsing' && <div className="text-sm text-gray-500 py-6 text-center">Reading the email…</div>}
          {phase === 'error' && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{errMsg}</div>}

          {phase === 'ready' && (
            <>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-1">Production company</label>
                    <input
                      value={clientName ?? ''}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="e.g. Golden Heart Films"
                      className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-[12px] text-gray-800 placeholder-gray-300 focus:outline-none focus:border-gray-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-1">Project / job name</label>
                    <input
                      value={jobName ?? ''}
                      onChange={(e) => setJobName(e.target.value)}
                      placeholder="e.g. Neon Nights"
                      className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-[12px] text-gray-800 placeholder-gray-300 focus:outline-none focus:border-gray-400"
                    />
                  </div>
                </div>
                {/* Ask only for the field(s) we don't have. Hidden entirely
                    when both are filled — there's nothing to ask. The label
                    names exactly what the reply will request. */}
                {(() => {
                  const companyMissing = !clientName?.trim();
                  const jobMissing = !jobName?.trim();
                  if (!companyMissing && !jobMissing) return null;
                  const askField =
                    companyMissing && jobMissing
                      ? 'production company & project name'
                      : companyMissing
                        ? 'production company'
                        : 'project name';
                  return (
                    <label className="flex items-start gap-2 text-[12px] text-gray-700 cursor-pointer select-none">
                      <input type="checkbox" checked={askForDetails} onChange={(e) => setAskForDetails(e.target.checked)} className="mt-0.5 accent-emerald-600" />
                      <span>Ask the client for their {askField} in the reply<span className="text-gray-400"> — we don&apos;t have {companyMissing && jobMissing ? 'these' : 'this'} yet</span></span>
                    </label>
                  );
                })()}
                <div className="text-[12px] text-gray-700 pt-0.5 border-t border-gray-200">
                  <div><span className="text-gray-400">Dates</span> · {fmt(pickup)} – {fmt(ret)}</div>
                  <div><span className="text-gray-400">Reply to</span> · {recipientName ? `${recipientName} ` : ''}<span className="font-mono text-gray-600">{recipientEmail || '(no email found)'}</span></div>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-1.5">Availability for these dates</div>
                {lines.length === 0 ? (
                  <div className="text-[12px] text-gray-500">No specific trucks/categories detected — the reply will ask for their item list.</div>
                ) : (
                  <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {lines.map((l) => (
                      <li key={l.id} className="px-3 py-2 flex items-center justify-between text-[12px]">
                        <span className="text-gray-800 font-medium">{l.name} <span className="text-gray-400">×{l.requested}</span></span>
                        <span className="flex items-center gap-2">
                          <span className="text-gray-400 text-[11px]">{l.availableToHold} of {l.serviceableCount} open</span>
                          <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_PILL[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <label className={`flex items-start gap-2 text-[12px] ${holdable ? 'text-gray-700' : 'text-gray-400'} ${holdable ? 'cursor-pointer' : 'cursor-not-allowed'} select-none`}>
                <input type="checkbox" checked={softHold} disabled={!holdable} onChange={(e) => setSoftHold(e.target.checked)} className="mt-0.5 accent-emerald-600" />
                <span>
                  Create soft holds so these show as spoken-for on the gantt until the client confirms.
                  {!holdable && <span className="block text-[11px] text-gray-400 mt-0.5">Unavailable — add the client &amp; contact to the CRM first (or no dated categories detected).</span>}
                </span>
              </label>

              {softHold && holdable && (
                <div className="text-[12px] pl-6 -mt-2">
                  {job ? (
                    <span className="text-gray-700">
                      Holds go into <span className="font-mono text-[11px] text-gray-500">[{job.jobCode}]</span>{' '}
                      <span className="font-medium">{job.name}</span>
                      <button type="button" onClick={() => setResolverOpen(true)} className="ml-2 text-[11px] font-medium text-emerald-700 hover:text-emerald-800">
                        Change
                      </button>
                    </span>
                  ) : (
                    <span className="text-gray-400">
                      You&rsquo;ll pick or create the Job for these holds when you hit send — we check for an existing Job on this shoot first.
                    </span>
                  )}
                </div>
              )}

              {holdStatus && <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1.5">{holdStatus}</div>}
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-gray-500 hover:text-gray-800 text-sm font-medium">Cancel</button>
          <button
            onClick={reviewAndSend}
            disabled={phase !== 'ready' || !recipientEmail || working}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-300 text-white text-sm font-bold rounded-lg"
          >
            {working ? 'Preparing…' : 'Review & send reply →'}
          </button>
        </footer>
      </div>
    </div>
  );
}
