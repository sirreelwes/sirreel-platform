'use client';

/**
 * COI review desk — open a filed certificate, judge it, act on it.
 *
 * Before this, a certificate could only be signed off in the moment an agent
 * uploaded it. Anything that arrived any other way (the client's no-login
 * drop link, the portal upload) sat PENDING forever with no surface in HQ to
 * approve or reject it — and nothing anywhere compared the certificate's
 * named insured against the production company we papered the job under.
 *
 * The three things a reviewer needs are in one place on purpose:
 *   1. the document itself
 *   2. the AI findings + the named-insured comparison
 *   3. the fixes — correct the production company, and re-issue an agreement
 *      that was signed under the wrong one
 *
 * (3) is here — not only on the job page — because the mismatch is
 * discovered HERE. Sending someone off to find the right screen is how a
 * wrong-entity agreement stays out in the world. The panel itself
 * (ChangeProductionCompany) is shared with the job header, so the two
 * entry points cannot drift on what a company change costs.
 */

import { useCallback, useEffect, useState } from 'react';
import { ChangeProductionCompany } from '@/components/jobs/ChangeProductionCompany';
import {
  INSURED_MATCH_LABEL,
  INSURED_MATCH_TONE,
  type InsuredMatchResult,
} from '@/lib/coi/insuredMatch';
import type { CoiChecklistRow } from '@/lib/coi/checks';

interface StaleAgreement {
  orderId: string;
  orderNumber: string;
  contractType: string;
  status: string;
  signedAt: string | null;
  signerName: string | null;
}

interface CoiReviewData {
  id: string;
  originalFilename: string;
  downloadUrl: string;
  source: string | null;
  uploadedBy: string | null;
  createdAt: string;
  namedInsured: string | null;
  policyExpiryDate: string | null;
  coverageVerified: boolean;
  additionalInsured: boolean;
  aiRiskLevel: string | null;
  aiNotes: string | null;
  aiOverallPass: boolean;
  aiAlertOpen: number;
  aiChecks: CoiChecklistRow[];
  aiHasChecklist: boolean;
  aiRan: boolean;
  aiHasInsuredName: boolean;
  humanDecision: string;
  humanDecisionNote: string | null;
  humanDecisionAt: string | null;
  humanDecisionBy: string | null;
  job: { id: string; name: string; jobCode: string; companyId: string | null } | null;
  companyName: string | null;
  match: InsuredMatchResult;
  signedAgreements: StaleAgreement[];
  /** Who we can send the "still missing" note to, best recipient first. */
  contacts: { name: string; email: string; role: string | null }[];
  /** Server-built draft of what the certificate still needs. */
  fixDraft: { issues: string[]; message: string };
}

const CHECK_MARK: Record<CoiChecklistRow['status'], string> = {
  PASS: '✓',
  FAIL: '✗',
  UNKNOWN: '–',
};

const CHECK_TONE: Record<CoiChecklistRow['status'], string> = {
  PASS: 'text-emerald-400',
  FAIL: 'text-rose-400',
  // Deliberately not amber: an unasked question is not a warning about the
  // certificate, it is a gap in OUR review. Amber would read as the client's
  // problem to fix.
  UNKNOWN: 'text-zinc-600',
};

/**
 * The per-check verdicts. Critical first, then the judgment calls — the
 * order a reviewer works in. A row the review never judged shows as "–  not
 * checked" rather than being hidden, because "nobody looked" is the finding.
 */
function Checklist({ rows }: { rows: CoiChecklistRow[] }) {
  const groups: { tier: CoiChecklistRow['tier']; label: string; rows: CoiChecklistRow[] }[] = [
    { tier: 'CRITICAL', label: 'Required', rows: rows.filter((r) => r.tier === 'CRITICAL') },
    { tier: 'ALERT', label: 'Judgment call', rows: rows.filter((r) => r.tier === 'ALERT') },
  ];
  return (
    <div className="mt-2.5 space-y-2.5">
      {groups.map((g) =>
        g.rows.length === 0 ? null : (
          <div key={g.tier}>
            <div className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold mb-1">
              {g.label}
            </div>
            <div className="space-y-0.5">
              {g.rows.map((r) => (
                <div key={r.key}>
                  <div className="flex items-baseline gap-2 text-[12px]">
                    <span className={`${CHECK_TONE[r.status]} font-bold w-3 flex-shrink-0`}>
                      {CHECK_MARK[r.status]}
                    </span>
                    <span
                      className={`flex-1 min-w-0 ${
                        r.status === 'FAIL'
                          ? 'text-rose-200'
                          : r.status === 'UNKNOWN'
                            ? 'text-zinc-500'
                            : 'text-zinc-300'
                      }`}
                    >
                      {r.label}
                    </span>
                    <span className="text-[11px] text-zinc-500 text-right truncate max-w-[45%]">
                      {r.status === 'UNKNOWN' ? 'not checked' : r.found || ''}
                    </span>
                  </div>
                  {r.status === 'FAIL' && r.note && (
                    <div className="ml-5 mt-0.5 text-[11px] leading-relaxed text-rose-300/80">{r.note}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CoiReviewModal({
  coiId,
  onClose,
  onChanged,
}: {
  coiId: string;
  onClose: () => void;
  /** Fired after any mutation so the parent can reload its own view. */
  onChanged?: () => void;
}) {
  const [data, setData] = useState<CoiReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  // "Ask the client to fix it" compose state. Opens inline rather than as a
  // second modal — the reviewer is reading the certificate on the left while
  // they write. Named ask* because fix* already belongs to the
  // fix-the-production-company sub-flow below.
  const [askOpen, setAskOpen] = useState(false);
  const [askTo, setAskTo] = useState('');
  const [askMsg, setAskMsg] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [note, setNote] = useState('');
  const [expiry, setExpiry] = useState('');

  // Fix-the-company sub-flow. The panel owns the move, the fallout and the
  // re-issue (shared with the job header) — this modal only decides when to
  // show it and refreshes the verdict afterwards.
  const [fixOpen, setFixOpen] = useState(false);

  const apply = useCallback(
    (d: CoiReviewData) => {
      setData(d);
      setNote(d.humanDecisionNote || '');
      setExpiry(d.policyExpiryDate ? d.policyExpiryDate.slice(0, 10) : '');
      // Seed the compose fields only while the panel is closed — a re-run or
      // a company change mid-compose must not wipe what the reviewer typed.
      setAskOpen((open) => {
        if (!open) {
          setAskTo(d.contacts[0]?.email || '');
          setAskMsg(d.fixDraft?.message || '');
        }
        return open;
      });
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/coi/review/${coiId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.ok) apply(d.coi);
        else setError(d?.error || 'Could not load this certificate.');
      })
      .catch(() => !cancelled && setError('Could not load this certificate.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [coiId, apply]);

  const post = async (bodyIn: Record<string, unknown>, label: string) => {
    setBusy(label);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/coi/review/${coiId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyIn),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) {
        setError(d?.error || 'That did not go through.');
        return null;
      }
      apply(d.coi);
      onChanged?.();
      return d.coi as CoiReviewData;
    } catch {
      setError('That did not go through.');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const decide = async (decision: 'APPROVED' | 'REJECTED' | 'PENDING') => {
    const d = await post({ decision, note, policyExpiryDate: expiry }, decision);
    if (d) {
      setFlash(
        decision === 'APPROVED'
          ? 'Approved — the job now reads Verified.'
          : decision === 'REJECTED'
            ? 'Rejected. The client needs a corrected certificate.'
            : 'Moved back to pending.',
      );
    }
  };

  const requestFix = async () => {
    const d = await post({ action: 'REQUEST_FIX', to: askTo, message: askMsg, note }, 'REQUEST_FIX');
    if (d) {
      setAskOpen(false);
      setFlash(`Sent to ${askTo} — marked as changes requested.`);
    }
  };

  const rerun = async () => {
    const d = await post({ action: 'RERUN_AI' }, 'RERUN');
    if (d) {
      setFlash(
        d.aiHasChecklist
          ? `AI review re-run against the stored file — all fifteen requirements judged.`
          : 'AI review re-run against the stored file.',
      );
    }
  };

  // Re-read after a company change so the match banner re-evaluates against
  // the company the job is NOW under.
  const refresh = useCallback(async () => {
    onChanged?.();
    const fresh = await fetch(`/api/coi/review/${coiId}`)
      .then((r) => r.json())
      .catch(() => null);
    if (fresh?.ok) apply(fresh.coi);
  }, [coiId, apply, onChanged]);

  const match = data?.match;
  const attention = !!match?.needsAttention;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white truncate">Review certificate</h3>
            <p className="text-[11px] text-zinc-500 truncate">
              {data?.originalFilename || '…'}
              {data?.job && (
                <>
                  {' · '}
                  {data.job.name} · {data.job.jobCode}
                </>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none pl-4">
            ×
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-16 text-center text-sm text-zinc-500">Loading…</div>
        ) : !data ? (
          <div className="px-5 py-16 text-center text-sm text-rose-300">{error || 'Not found.'}</div>
        ) : (
          <div className="flex-1 overflow-y-auto grid md:grid-cols-[1.1fr_1fr] gap-0">
            {/* The document. Served through the authed private-blob proxy. */}
            <div className="border-r border-zinc-800 bg-zinc-950/60 p-4">
              <iframe
                src={data.downloadUrl}
                title="Certificate of insurance"
                className="w-full h-[60vh] rounded-lg border border-zinc-800 bg-white"
              />
              <a
                href={data.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-[12px] font-semibold text-amber-400 hover:text-amber-300"
              >
                Open in a new tab →
              </a>
            </div>

            <div className="p-5 space-y-4">
              {/* Named insured vs production company — the finding this whole
                  screen was built around. Loudest element on the panel when
                  it needs attention. */}
              {match && match.verdict !== 'UNKNOWN' && (
                <div
                  className={`rounded-xl border px-3.5 py-3 ${
                    attention ? 'border-rose-500/40 bg-rose-500/5' : 'border-zinc-800 bg-zinc-950/60'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${INSURED_MATCH_TONE[match.verdict]}`}
                    >
                      {INSURED_MATCH_LABEL[match.verdict]}
                    </span>
                  </div>
                  <div className="text-[13px] text-zinc-200 leading-relaxed">{match.message}</div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                    <dt className="text-zinc-500">On the certificate</dt>
                    <dd className="text-white">{match.namedInsured || '—'}</dd>
                    <dt className="text-zinc-500">On the job</dt>
                    <dd className="text-white">
                      {data.companyName || '—'}
                      {data.job?.name && data.job.name !== data.companyName && (
                        <span className="text-zinc-500"> · {data.job.name}</span>
                      )}
                    </dd>
                  </dl>
                  {attention && data.job && (
                    <button
                      onClick={() => setFixOpen((v) => !v)}
                      className="mt-2.5 text-[12px] font-semibold text-amber-300 hover:text-amber-200"
                    >
                      {fixOpen ? 'Cancel' : 'Fix the production company →'}
                    </button>
                  )}
                </div>
              )}

              {match?.verdict === 'UNKNOWN' && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-3">
                  <div className="text-[13px] text-zinc-300">{match.message}</div>
                </div>
              )}

              {/* Correct the production company, then offer the re-issue. */}
              {fixOpen && data.job && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] px-3.5 py-3">
                  <ChangeProductionCompany
                    jobId={data.job.id}
                    currentCompanyName={data.companyName}
                    suggestedName={match?.namedInsured ?? null}
                    onChanged={refresh}
                  />
                </div>
              )}

              {/* Certificate already signed and NOT (yet) invalidated — shown
                  so a reviewer knows what a company change would cost. */}
              {!fixOpen && data.signedAgreements.length > 0 && attention && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5 text-[12px] text-zinc-400">
                  Heads up: {data.signedAgreements.length} agreement
                  {data.signedAgreements.length === 1 ? ' is' : 's are'} already signed on this job. Changing
                  the production company will offer to re-issue{' '}
                  {data.signedAgreements.length === 1 ? 'it' : 'them'}.
                </div>
              )}

              {/* AI findings */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold">
                    AI review
                  </div>
                  <button
                    onClick={rerun}
                    disabled={busy === 'RERUN'}
                    className="text-[12px] font-semibold text-amber-300 hover:text-amber-200 disabled:opacity-50"
                  >
                    {busy === 'RERUN'
                      ? 'Running…'
                      : !data.aiRan
                        ? 'Run AI review'
                        : !data.aiHasInsuredName
                          ? 'Check insured name'
                          : 'Re-run'}
                  </button>
                </div>
                {/* A review filed before the prompt asked for the named insured
                    CANNOT produce a name match, so "Re-run" reads as an
                    optional redo of work already done. Say what is actually
                    missing instead. */}
                {data.aiRan && !data.aiHasChecklist ? (
                  <div className="mb-2 rounded-lg border border-amber-700/50 bg-amber-950/25 px-2.5 py-2 text-[12px] leading-relaxed text-amber-200/90">
                    This review predates the full checklist. It never asked about Primary &amp;
                    Non-Contributory, Waiver of Subrogation, Umbrella, Workers Comp, the
                    cancellation clause or contractor coverage
                    {data.aiHasInsuredName ? '' : ', and never read who the policy insures'}. Re-run
                    it to judge this certificate on all fifteen requirements.
                  </div>
                ) : data.aiRan && !data.aiHasInsuredName ? (
                  <div className="mb-2 rounded-lg border border-amber-700/50 bg-amber-950/25 px-2.5 py-2 text-[12px] leading-relaxed text-amber-200/90">
                    This review predates insured-name checking, so the certificate has
                    never been read for who it insures. Run it to compare against the
                    production company.
                  </div>
                ) : null}
                {data.aiRan ? (
                  <>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                          data.aiRiskLevel === 'low'
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : data.aiRiskLevel === 'high'
                              ? 'bg-rose-500/10 text-rose-300'
                              : 'bg-amber-500/10 text-amber-300'
                        }`}
                      >
                        {data.aiRiskLevel || 'unknown'} risk
                      </span>
                      <span className="text-[12px] text-zinc-400">
                        {data.aiOverallPass ? 'Every required item met' : 'Needs review'}
                        {data.aiHasChecklist && data.aiAlertOpen > 0 && (
                          <span className="text-amber-300/80">
                            {' · '}
                            {data.aiAlertOpen} judgment call{data.aiAlertOpen === 1 ? '' : 's'} open
                          </span>
                        )}
                      </span>
                    </div>
                    {data.aiNotes && (
                      <p className="text-[12px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {data.aiNotes}
                      </p>
                    )}
                    {data.aiHasChecklist && <Checklist rows={data.aiChecks} />}
                  </>
                ) : (
                  <p className="text-[12px] text-zinc-400">
                    No AI review on file — certificates dropped through the client link are stored without
                    one. Run it to read coverage, expiry and the named insured.
                  </p>
                )}
              </div>

              {/* Decision */}
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Policy expires</label>
                    <input
                      type="date"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div className="flex flex-col justify-end text-[12px] text-zinc-400 pb-2">
                    {data.humanDecision !== 'PENDING' ? (
                      <span>
                        {data.humanDecision === 'APPROVED'
                          ? 'Approved'
                          : data.humanDecision === 'COUNTERED'
                            ? 'Changes requested'
                            : 'Rejected'}
                        {data.humanDecisionBy ? ` by ${data.humanDecisionBy}` : ''} ·{' '}
                        {fmtDate(data.humanDecisionAt)}
                      </span>
                    ) : (
                      <span>Awaiting a decision</span>
                    )}
                  </div>
                </div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Note (what you checked, what the client still owes us)"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[13px] text-white placeholder-zinc-500"
                />
                {/* Ask the client to fix it — the third option. Rejecting is the
                    end of the conversation inside HQ; this is the one that
                    actually tells the client what to go get. */}
                {askOpen ? (
                  <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                        Ask the client to fix it
                      </span>
                      <button
                        onClick={() => setAskOpen(false)}
                        className="text-[11px] text-zinc-400 hover:text-zinc-200"
                      >
                        Cancel
                      </button>
                    </div>
                    {data.contacts.length > 1 && (
                      <select
                        value={askTo}
                        onChange={(e) => setAskTo(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[13px] text-white"
                      >
                        {data.contacts.map((c) => (
                          <option key={c.email} value={c.email}>
                            {c.name} · {c.email}
                            {c.role ? ` · ${c.role}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      type="email"
                      value={askTo}
                      onChange={(e) => setAskTo(e.target.value)}
                      placeholder="client@example.com"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[13px] text-white placeholder-zinc-500"
                    />
                    <textarea
                      value={askMsg}
                      onChange={(e) => setAskMsg(e.target.value)}
                      rows={10}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[12px] text-white leading-relaxed"
                    />
                    <p className="text-[11px] text-zinc-500">
                      Sends exactly what&rsquo;s in the box, replies come back to you, and the
                      certificate moves to <span className="text-zinc-300">Changes requested</span>.
                    </p>
                    <button
                      onClick={requestFix}
                      disabled={!!busy || !askTo.trim() || !askMsg.trim()}
                      className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg py-2"
                    >
                      {busy === 'REQUEST_FIX' ? 'Sending…' : 'Send to client'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setError(null);
                      setFlash(null);
                      setAskOpen(true);
                    }}
                    disabled={!!busy || data.contacts.length === 0}
                    title={
                      data.contacts.length === 0
                        ? 'No client contact on this job to email — add one on the job first.'
                        : 'Email the client what this certificate is still missing'
                    }
                    className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-amber-300 text-[13px] font-semibold rounded-lg py-2"
                  >
                    Request fix from client
                    {data.fixDraft?.issues?.length ? ` · ${data.fixDraft.issues.length} issue${data.fixDraft.issues.length === 1 ? '' : 's'}` : ''}
                  </button>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => decide('APPROVED')}
                    disabled={!!busy}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg py-2"
                  >
                    {busy === 'APPROVED' ? 'Saving…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => decide('REJECTED')}
                    disabled={!!busy}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-rose-300 text-[13px] font-semibold rounded-lg py-2"
                  >
                    {busy === 'REJECTED' ? 'Saving…' : 'Reject'}
                  </button>
                  {data.humanDecision !== 'PENDING' && (
                    <button
                      onClick={() => decide('PENDING')}
                      disabled={!!busy}
                      className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-[13px] font-semibold rounded-lg px-3 py-2"
                    >
                      Undo
                    </button>
                  )}
                </div>
              </div>

              {error && <div className="text-[12px] text-rose-300">{error}</div>}
              {flash && <div className="text-[12px] text-emerald-300">{flash}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
