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
 * (3) is here rather than buried on the job page because the mismatch is
 * discovered HERE. Sending someone to go find the right screen is how a
 * wrong-entity agreement stays out in the world.
 */

import { useCallback, useEffect, useState } from 'react';
import { CompanyPicker } from '@/components/orders/CompanyPicker';
import {
  INSURED_MATCH_LABEL,
  INSURED_MATCH_TONE,
  type InsuredMatchResult,
} from '@/lib/coi/insuredMatch';

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
  aiRan: boolean;
  humanDecision: string;
  humanDecisionNote: string | null;
  humanDecisionAt: string | null;
  humanDecisionBy: string | null;
  job: { id: string; name: string; jobCode: string; companyId: string | null } | null;
  companyName: string | null;
  match: InsuredMatchResult;
  signedAgreements: StaleAgreement[];
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [note, setNote] = useState('');
  const [expiry, setExpiry] = useState('');

  // Fix-the-company sub-flow
  const [fixOpen, setFixOpen] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [staleAgreements, setStaleAgreements] = useState<StaleAgreement[] | null>(null);
  const [priorCompanyName, setPriorCompanyName] = useState<string | null>(null);
  const [reissueReason, setReissueReason] = useState('');

  const apply = useCallback(
    (d: CoiReviewData) => {
      setData(d);
      setNote(d.humanDecisionNote || '');
      setExpiry(d.policyExpiryDate ? d.policyExpiryDate.slice(0, 10) : '');
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

  const rerun = async () => {
    const d = await post({ action: 'RERUN_AI' }, 'RERUN');
    if (d) setFlash('AI review re-run against the stored file.');
  };

  const fixCompany = async () => {
    if (!data?.job) return;
    const payload = companyId ? { companyId } : { companyName: newCompanyName.trim() };
    if (!companyId && !newCompanyName.trim()) {
      setError('Pick an existing company or type the correct name.');
      return;
    }
    setBusy('FIX');
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/jobs/${data.job.id}/company`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) {
        setError(d?.error || 'Could not change the production company.');
        return;
      }
      setPriorCompanyName(d.previousCompanyName ?? null);
      setStaleAgreements(d.staleAgreements || []);
      setReissueReason(
        `The agreement was signed under ${d.previousCompanyName || 'the previous company'}; this rental is under ${d.company.name}.`,
      );
      setFixOpen(false);
      setFlash(
        `Moved to ${d.company.name}${d.ordersMoved ? ` (${d.ordersMoved} order${d.ordersMoved === 1 ? '' : 's'} re-pointed)` : ''}.`,
      );
      onChanged?.();
      // Refresh so the match banner re-evaluates against the new company.
      const fresh = await fetch(`/api/coi/review/${coiId}`).then((r) => r.json());
      if (fresh?.ok) apply(fresh.coi);
    } catch {
      setError('Could not change the production company.');
    } finally {
      setBusy(null);
    }
  };

  const reissue = async (a: StaleAgreement) => {
    if (!reissueReason.trim()) {
      setError('Say why it is being re-issued — it becomes the audit record.');
      return;
    }
    setBusy(`REISSUE:${a.orderId}`);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${a.orderId}/agreement/reissue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reissueReason.trim(),
          contractType: a.contractType,
          priorCompanyName,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) {
        setError(d?.error || 'Could not re-issue that agreement.');
        return;
      }
      setStaleAgreements((prev) => (prev || []).filter((x) => x.orderId !== a.orderId));
      setFlash(
        d.needsStageRegeneration
          ? `${a.orderNumber}: signature cleared — regenerate the stage contract before it can be signed.`
          : d.emailed
            ? `${a.orderNumber}: re-issued and emailed to the client to sign.`
            : `${a.orderNumber}: re-issued. ${d.emailError || 'Send the portal link manually.'}`,
      );
      onChanged?.();
    } catch {
      setError('Could not re-issue that agreement.');
    } finally {
      setBusy(null);
    }
  };

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
                      onClick={() => {
                        setFixOpen((v) => !v);
                        if (!newCompanyName && match.namedInsured) setNewCompanyName(match.namedInsured);
                      }}
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
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] px-3.5 py-3 space-y-2.5">
                  <div className="text-[12px] text-zinc-300">
                    Move this job (and its orders) to the company that is actually renting.
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Existing company</label>
                    <CompanyPicker
                      value={companyId}
                      selectedName={companyName}
                      onChange={(id, name) => {
                        setCompanyId(id || null);
                        setCompanyName(name || null);
                      }}
                    />
                  </div>
                  {!companyId && (
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">
                        …or create it from the certificate
                      </label>
                      <input
                        value={newCompanyName}
                        onChange={(e) => setNewCompanyName(e.target.value)}
                        placeholder="Production company name"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500"
                      />
                    </div>
                  )}
                  <button
                    onClick={fixCompany}
                    disabled={busy === 'FIX'}
                    className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg py-2"
                  >
                    {busy === 'FIX' ? 'Moving…' : 'Change production company'}
                  </button>
                </div>
              )}

              {/* Anything already signed under the old company. */}
              {staleAgreements && staleAgreements.length > 0 && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 px-3.5 py-3 space-y-2.5">
                  <div className="text-[13px] font-semibold text-rose-200">
                    Signed under the old company — re-issue to the new one
                  </div>
                  <textarea
                    value={reissueReason}
                    onChange={(e) => setReissueReason(e.target.value)}
                    rows={2}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[12px] text-white"
                    placeholder="Why it is being re-issued (goes to the client and into the audit record)"
                  />
                  {staleAgreements.map((a) => (
                    <div key={`${a.orderId}:${a.contractType}`} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 text-[12px] text-zinc-300">
                        <span className="text-white">{a.orderNumber}</span>
                        <span className="text-zinc-500">
                          {' '}
                          · {a.contractType === 'STAGE_CONTRACT' ? 'Stage contract' : 'Rental agreement'} ·
                          signed {fmtDate(a.signedAt)}
                          {a.signerName ? ` by ${a.signerName}` : ''}
                        </span>
                      </div>
                      <button
                        onClick={() => reissue(a)}
                        disabled={busy === `REISSUE:${a.orderId}`}
                        className="shrink-0 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-rose-200 text-[12px] font-semibold rounded-lg px-2.5 py-1.5"
                      >
                        {busy === `REISSUE:${a.orderId}` ? 'Re-issuing…' : 'Re-issue & email'}
                      </button>
                    </div>
                  ))}
                  <p className="text-[11px] text-zinc-500">
                    The old signature is kept as an audit record; the client is asked to sign the corrected
                    agreement.
                  </p>
                </div>
              )}

              {/* Certificate already signed and NOT (yet) invalidated — shown
                  so a reviewer knows what a company change would cost. */}
              {!staleAgreements && data.signedAgreements.length > 0 && attention && (
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
                    {busy === 'RERUN' ? 'Running…' : data.aiRan ? 'Re-run' : 'Run AI review'}
                  </button>
                </div>
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
                        {data.aiOverallPass ? 'Passes the checks' : 'Needs review'}
                      </span>
                    </div>
                    {data.aiNotes && (
                      <p className="text-[12px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {data.aiNotes}
                      </p>
                    )}
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
                <div className="grid grid-cols-2 gap-2">
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
                        {data.humanDecision === 'APPROVED' ? 'Approved' : 'Rejected'}
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
