'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ReviewResultPanel, type DecisionState, type ClauseDecisionValue } from '@/components/reviews/ReviewResultPanel';
import { CounterPdfPreview } from '@/components/reviews/CounterPdfPreview';
import { CounterProposalEmail } from '@/components/reviews/CounterProposalEmail';

const RISK_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-emerald-100 text-emerald-700',
};

interface ServerDecision {
  id: string;
  clauseRef: string;
  changeType: string;
  changeIndex: number;
  decision: ClauseDecisionValue;
  counterLanguage: string | null;
  note: string | null;
  decidedAt: string | null;
  decidedBy: { id: string; name: string; email: string } | null;
}

interface ReviewRecord {
  id: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
  aiResponse: any;
  aiRiskLevel: string | null;
  aiRecommendation: string | null;
  annotationManifest: any;
  humanDecision: string;
  humanDecisionNote: string | null;
  humanDecisionAt: string | null;
  company: { id: string; name: string } | null;
  job: { id: string; jobCode: string; name: string } | null;
  uploadedBy: { id: string; name: string; email: string } | null;
  humanDecisionBy: { id: string; name: string; email: string } | null;
  changeDecisions: ServerDecision[];
  counterPdfKey: string | null;
  counterGeneratedAt: string | null;
  counterGeneratedBy: { id: string; name: string; email: string } | null;
  signedAgreement: {
    id: string;
    status: string;
    documentType: string;
    orderId: string;
    order: { id: string; orderNumber: string; company: { name: string } | null } | null;
  } | null;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildInitialDecisions(record: ReviewRecord): Record<number, DecisionState> {
  const out: Record<number, DecisionState> = {};
  for (const d of record.changeDecisions || []) {
    out[d.changeIndex] = {
      decision: d.decision,
      counterLanguage: d.counterLanguage || '',
      note: d.note || '',
    };
  }
  return out;
}

type Tab = 'original' | 'counter';

export default function ContractReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) || '';

  const [record, setRecord] = useState<ReviewRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [decisions, setDecisions] = useState<Record<number, DecisionState>>({});
  const [savingDecisions, setSavingDecisions] = useState(false);
  const [decisionsDirty, setDecisionsDirty] = useState(false);
  const [decisionsSavedAt, setDecisionsSavedAt] = useState<string | null>(null);

  const [secondRoundClauses, setSecondRoundClauses] = useState<string[]>([]);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState('');
  const [showRerunConfirm, setShowRerunConfirm] = useState(false);

  const [tab, setTab] = useState<Tab>('original');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [pdfCacheKey, setPdfCacheKey] = useState<string>('');
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  const [acceptingFinal, setAcceptingFinal] = useState(false);
  const [acceptFinalError, setAcceptFinalError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/tools/contract-review/${id}`)
      .then(async (r) => {
        if (r.status === 404) {
          setError('Review not found.');
          return null;
        }
        if (!r.ok) {
          setError('Failed to load review.');
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.review) {
          const rec = data.review as ReviewRecord;
          setRecord(rec);
          setDecisions(buildInitialDecisions(rec));
          setDecisionsDirty(false);
          setPdfCacheKey(rec.counterGeneratedAt || '');
          const meta = rec.aiResponse?._meta;
          if (meta && Array.isArray(meta.secondRoundClauses)) {
            setSecondRoundClauses(meta.secondRoundClauses.map((s: unknown) => String(s)));
          } else {
            setSecondRoundClauses([]);
          }
        }
      })
      .catch(() => setError('Failed to load review.'))
      .finally(() => setLoading(false));
  }, [id]);

  const aiChanges: any[] = record?.aiResponse?.changes || [];
  const totalChanges = aiChanges.length;

  const counts = useMemo(() => {
    let pending = 0, accept = 0, counter = 0, reject = 0;
    for (let i = 0; i < totalChanges; i++) {
      const d = decisions[i]?.decision || 'PENDING';
      if (d === 'ACCEPT') accept++;
      else if (d === 'COUNTER') counter++;
      else if (d === 'REJECT') reject++;
      else pending++;
    }
    return { pending, accept, counter, reject };
  }, [decisions, totalChanges]);

  const allDecided = totalChanges > 0 && counts.pending === 0;
  const canGenerate = allDecided && !decisionsDirty;
  const counterExists = !!record?.counterPdfKey;

  const handleDecisionChange = (changeIndex: number, next: DecisionState) => {
    setDecisions((prev) => ({ ...prev, [changeIndex]: next }));
    setDecisionsDirty(true);
  };

  const persistedSecondRound = useMemo(() => {
    const meta = record?.aiResponse?._meta;
    if (meta && Array.isArray(meta.secondRoundClauses)) {
      return (meta.secondRoundClauses as unknown[]).map((s) => String(s)).sort();
    }
    return [] as string[];
  }, [record]);

  const secondRoundDirty = useMemo(() => {
    const a = [...secondRoundClauses].sort();
    const b = [...persistedSecondRound];
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return false;
  }, [secondRoundClauses, persistedSecondRound]);

  const handleToggleSecondRound = (clauseRef: string, next: boolean) => {
    setSecondRoundClauses((prev) => {
      const set = new Set(prev);
      if (next) set.add(clauseRef);
      else set.delete(clauseRef);
      return Array.from(set);
    });
  };

  const runRerun = async () => {
    if (!record) return;
    setRerunning(true);
    setRerunError('');
    try {
      const res = await fetch(`/api/tools/contract-review/${id}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secondRoundClauses }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setRerunError(err.error || 'Failed to re-run AI review');
        return;
      }
      await refreshRecord();
    } finally {
      setRerunning(false);
      setShowRerunConfirm(false);
    }
  };

  const handleRerunClick = () => {
    setShowRerunConfirm(true);
  };

  const saveDecisions = async () => {
    if (!record) return;
    const existingDecisions = record.changeDecisions || [];
    const payload = aiChanges.flatMap((ch: any, i: number) => {
      const local = decisions[i];
      if (!local) return [];
      const existed = existingDecisions.some((d) => d.changeIndex === i);
      if (local.decision === 'PENDING' && !existed) return [];
      return [{
        clauseRef: String(ch.clause ?? ''),
        changeType: String(ch.type ?? 'needs_review'),
        changeIndex: i,
        decision: local.decision,
        counterLanguage: local.counterLanguage || null,
        note: local.note || null,
      }];
    });

    if (payload.length === 0) {
      setDecisionsDirty(false);
      return;
    }

    for (const d of payload) {
      if (d.decision === 'COUNTER' && !d.counterLanguage) {
        alert(`Counter-language required for clause ${d.clauseRef || `#${d.changeIndex + 1}`}.`);
        return;
      }
    }

    setSavingDecisions(true);
    try {
      const res = await fetch(`/api/tools/contract-review/${id}/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions: payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to save decisions');
        return;
      }
      const data = await res.json();
      if (Array.isArray(data?.decisions)) {
        setRecord((r) => (r ? { ...r, changeDecisions: data.decisions } : r));
      }
      setDecisionsDirty(false);
      setDecisionsSavedAt(new Date().toISOString());
    } finally {
      setSavingDecisions(false);
    }
  };

  const refreshRecord = async () => {
    const res = await fetch(`/api/tools/contract-review/${id}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.review) {
        setRecord(data.review);
        setPdfCacheKey(data.review.counterGeneratedAt || String(Date.now()));
      }
    }
  };

  const runGenerate = async () => {
    if (!record) return;
    setGenerating(true);
    setGenerateError('');
    try {
      const res = await fetch(`/api/tools/contract-review/${id}/generate-counter-pdf`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setGenerateError(err.error || 'Failed to generate counter-PDF');
        return;
      }
      await refreshRecord();
      setTab('counter');
    } finally {
      setGenerating(false);
      setShowRegenerateConfirm(false);
    }
  };

  const handleGenerateClick = () => {
    if (counterExists) {
      setShowRegenerateConfirm(true);
    } else {
      runGenerate();
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-400 py-12 text-center">Loading…</div>;
  }
  if (error) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
        <div className="text-sm text-red-600">{error}</div>
        <button onClick={() => router.push('/tools/contract-review')} className="text-xs font-semibold text-gray-600 hover:text-gray-900">
          ← Back to Contract Review
        </button>
      </div>
    );
  }
  if (!record) return null;

  const ai = record.aiResponse || {};

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <Link href="/tools/contract-review" className="text-xs font-semibold text-gray-500 hover:text-gray-900">
          ← Back to Contract Review
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-gray-900 truncate">{record.originalFilename}</h1>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Uploaded {fmtDateTime(record.createdAt)}
              {record.uploadedBy && <> by <span className="font-semibold">{record.uploadedBy.name}</span></>}
              {' · '}
              {(record.fileSize / 1024).toFixed(0)} KB
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {record.aiRiskLevel && (
              <span className={`text-[10px] font-bold px-2 py-1 rounded ${RISK_BADGE[record.aiRiskLevel] || 'bg-gray-100 text-gray-600'}`}>
                {record.aiRiskLevel.toUpperCase()} RISK
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {record.company ? (
            <Link href={`/crm/${record.company.id}`} className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 font-semibold">
              {record.company.name}
            </Link>
          ) : (
            <span className="px-2 py-1 bg-amber-50 border border-amber-200 rounded text-amber-700 italic">No company linked</span>
          )}
          {record.job ? (
            <Link href={`/jobs/${record.job.id}`} className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 font-semibold">
              [{record.job.jobCode}] {record.job.name}
            </Link>
          ) : (
            <span className="px-2 py-1 bg-amber-50 border border-amber-200 rounded text-amber-700 italic">No Job linked</span>
          )}
        </div>
      </div>

      {/* PDF tabs */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab('original')}
              className={`px-3 py-1.5 text-[11px] font-bold rounded-lg ${
                tab === 'original'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Original
            </button>
            <button
              onClick={() => setTab('counter')}
              className={`px-3 py-1.5 text-[11px] font-bold rounded-lg ${
                tab === 'counter'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Counter Proposal
              {counterExists && <span className="ml-1.5 text-emerald-400">●</span>}
            </button>
          </div>
        </div>

        {tab === 'original' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Original PDF</div>
              <a
                href={`/api/tools/contract-review/${id}/file`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-semibold text-gray-500 hover:text-gray-900"
              >
                Open in new tab ↗
              </a>
            </div>
            <iframe
              src={`/api/tools/contract-review/${id}/file`}
              className="w-full h-[600px] rounded-lg border border-gray-100 bg-gray-50"
              title="Contract PDF"
            />
          </div>
        )}

        {tab === 'counter' && (
          <>
            {counterExists ? (
              <>
                <CounterPdfPreview
                  reviewId={id}
                  generatedAt={record.counterGeneratedAt}
                  generatedBy={record.counterGeneratedBy}
                  cacheKey={pdfCacheKey || record.counterGeneratedAt || ''}
                  onRegenerate={() => setShowRegenerateConfirm(true)}
                  regenerating={generating}
                  canRegenerate={canGenerate}
                />
                <CounterProposalEmail
                  aiChanges={aiChanges}
                  decisions={(record.changeDecisions || []).map((d) => ({
                    clauseRef: d.clauseRef,
                    decision: d.decision,
                    note: d.note,
                    changeIndex: d.changeIndex,
                  }))}
                  company={{ name: record.company?.name || null }}
                  job={{
                    jobCode: record.job?.jobCode || null,
                    name: record.job?.name || null,
                  }}
                  primaryContact={null}
                  senderName={record.uploadedBy?.name || 'the SirReel team'}
                />
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center space-y-3">
                <div className="text-2xl">📄</div>
                <div className="text-sm font-semibold text-gray-700">No counter-proposal generated yet</div>
                <div className="text-[12px] text-gray-500 max-w-md mx-auto leading-relaxed">
                  {!allDecided
                    ? `Decide all ${totalChanges} clause${totalChanges === 1 ? '' : 's'} below, then save to enable generation.`
                    : decisionsDirty
                      ? 'Save your decisions to enable counter-PDF generation.'
                      : 'Your decisions are saved. Click below to generate the counter-PDF.'}
                </div>
                <button
                  onClick={handleGenerateClick}
                  disabled={!canGenerate || generating}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-[12px] font-bold rounded-xl"
                >
                  {generating ? 'Generating…' : 'Generate counter-PDF'}
                </button>
                {generateError && (
                  <div className="text-[11px] text-red-600 max-w-md mx-auto">{generateError}</div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Operator-review banner */}
      {(() => {
        const flaggedCount = (aiChanges || []).filter((c: any) => c?.needsOperatorReview === true).length;
        if (flaggedCount === 0) return null;
        return (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
            <div className="text-xl">⚠️</div>
            <div className="text-[12px] text-red-700 leading-relaxed">
              <div className="font-bold uppercase text-[10px] mb-1">Operator review required</div>
              {flaggedCount === 1
                ? 'One clause is flagged. Expand the change below to review the reason before generating the counter-PDF.'
                : `${flaggedCount} clauses are flagged. Expand the changes below to review each reason before generating the counter-PDF.`}
            </div>
          </div>
        );
      })()}

      {/* AI analysis with per-clause decisions */}
      <ReviewResultPanel
        review={ai}
        decisions={decisions}
        onDecisionChange={handleDecisionChange}
        secondRoundClauses={secondRoundClauses}
        onToggleSecondRound={handleToggleSecondRound}
        manifest={record.annotationManifest ?? null}
      />

      {/* Per-clause decision summary + Generate button */}
      {totalChanges > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Per-clause decisions</div>
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className="text-emerald-700 font-semibold">{counts.accept} accepted</span>
              <span className="text-gray-300">·</span>
              <span className="text-amber-700 font-semibold">{counts.counter} countered</span>
              <span className="text-gray-300">·</span>
              <span className="text-red-700 font-semibold">{counts.reject} rejected</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-500 font-semibold">{counts.pending} pending</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[11px] text-gray-500">
              {decisionsDirty
                ? 'Unsaved changes.'
                : decisionsSavedAt
                  ? `Saved ${fmtDateTime(decisionsSavedAt)}.`
                  : (record.changeDecisions || []).length > 0
                    ? `Last saved ${fmtDateTime((record.changeDecisions || [])[0]?.decidedAt ?? null)}.`
                    : 'No decisions saved yet.'}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={saveDecisions}
                disabled={savingDecisions || !decisionsDirty}
                className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 text-gray-800 text-[12px] font-bold rounded-xl"
              >
                {savingDecisions ? 'Saving…' : 'Save decisions'}
              </button>
              <button
                onClick={handleGenerateClick}
                disabled={!canGenerate || generating}
                title={
                  !allDecided
                    ? 'Decide all clauses first'
                    : decisionsDirty
                      ? 'Save your decisions first'
                      : counterExists
                        ? 'Regenerate counter-PDF'
                        : 'Generate counter-PDF'
                }
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-[12px] font-bold rounded-xl"
              >
                {generating
                  ? counterExists
                    ? 'Regenerating…'
                    : 'Generating…'
                  : counterExists
                    ? 'Regenerate counter-PDF'
                    : 'Generate counter-PDF'}
              </button>
            </div>
          </div>
          {generateError && (
            <div className="text-[11px] text-red-600 text-right">{generateError}</div>
          )}
        </div>
      )}

      {/* Second-round negotiation panel */}
      {totalChanges > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Second-round negotiation</div>
              <div className="text-[11px] text-gray-600 mt-1 leading-snug max-w-2xl">
                Mark clauses as second-round (per-clause toggle in each expanded change above) to instruct the AI to source
                counter language from the playbook&apos;s Acceptable Fallback. Then re-run to refresh the counter.
              </div>
            </div>
            <div className="text-[11px] text-gray-600 font-semibold">
              {secondRoundClauses.length === 0
                ? 'No clauses flagged'
                : `${secondRoundClauses.length} flagged: ${[...secondRoundClauses].sort().map((c) => `§${c}`).join(', ')}`}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[11px] text-gray-500">
              {secondRoundDirty
                ? 'Toggle changes are unsaved. Re-run to apply.'
                : record?.aiResponse?._meta?.rerunAt
                  ? `Last re-run ${fmtDateTime(record.aiResponse._meta.rerunAt)}.`
                  : 'AI has not been re-run with second-round flags yet.'}
            </div>
            <button
              onClick={handleRerunClick}
              disabled={rerunning || (!secondRoundDirty && secondRoundClauses.length === 0)}
              title={
                !secondRoundDirty && secondRoundClauses.length === 0
                  ? 'Flag at least one clause as second-round, or change the existing flags, before re-running'
                  : 'Re-run AI review with current second-round flags'
              }
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-[12px] font-bold rounded-xl"
            >
              {rerunning ? 'Re-running…' : 'Re-run AI with second-round flags'}
            </button>
          </div>
          {rerunError && (
            <div className="text-[11px] text-red-600 text-right">{rerunError}</div>
          )}
        </div>
      )}

      {/* Path A negotiated-agreement handoff */}
      {record.signedAgreement && (
        <div className="bg-white border border-indigo-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Linked client agreement</div>
              <div className="text-[12px] text-gray-700 mt-1">
                {record.signedAgreement.order
                  ? `Order ${record.signedAgreement.order.orderNumber}${
                      record.signedAgreement.order.company
                        ? ` · ${record.signedAgreement.order.company.name}`
                        : ''
                    }`
                  : 'Linked SignedAgreement'}
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-1 rounded bg-indigo-100 text-indigo-700">
              {record.signedAgreement.status.replace(/_/g, ' ')}
            </span>
          </div>
          {(record.signedAgreement.status === 'NEGOTIATED_READY' ||
            record.signedAgreement.status === 'SIGNED_NEGOTIATED' ||
            record.signedAgreement.status === 'SIGNED_BASELINE') ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-700">
              {record.signedAgreement.status === 'NEGOTIATED_READY' &&
                'Client has been emailed the negotiated version and the portal is unlocked for signing.'}
              {record.signedAgreement.status === 'SIGNED_NEGOTIATED' &&
                'Client signed the negotiated agreement. No further action required.'}
              {record.signedAgreement.status === 'SIGNED_BASELINE' &&
                'Client signed the baseline agreement before negotiation completed.'}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] text-gray-500 max-w-md">
                When you&rsquo;re done with per-clause decisions and the counter-PDF is generated, accept it as the
                final negotiated version to notify the client and unlock signing.
              </div>
              <button
                onClick={async () => {
                  if (!record.signedAgreement?.orderId) return;
                  setAcceptingFinal(true);
                  setAcceptFinalError('');
                  try {
                    const res = await fetch(
                      `/api/orders/${record.signedAgreement.orderId}/contract-review/accept`,
                      { method: 'POST' },
                    );
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      setAcceptFinalError(data.error || 'Failed to accept');
                      return;
                    }
                    await refreshRecord();
                  } finally {
                    setAcceptingFinal(false);
                  }
                }}
                disabled={acceptingFinal || !record.counterPdfKey}
                title={
                  !record.counterPdfKey
                    ? 'Generate the counter-PDF first'
                    : 'Accept this as the final negotiated agreement'
                }
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-[12px] font-bold rounded-xl"
              >
                {acceptingFinal ? 'Accepting…' : 'Accept as Final'}
              </button>
            </div>
          )}
          {acceptFinalError && (
            <div className="text-[11px] text-red-600 text-right">{acceptFinalError}</div>
          )}
        </div>
      )}

      {/* Audit footer */}
      <div className="text-[10px] text-gray-400 space-y-0.5 px-1">
        <div>
          Uploaded {fmtDateTime(record.createdAt)}
          {record.uploadedBy && <> by {record.uploadedBy.name} ({record.uploadedBy.email})</>}
        </div>
        {record.counterGeneratedAt && record.counterGeneratedBy && (
          <div>
            Counter-PDF generated {fmtDateTime(record.counterGeneratedAt)} by {record.counterGeneratedBy.name}
          </div>
        )}
      </div>

      {/* Re-run confirmation modal */}
      {showRerunConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !rerunning && setShowRerunConfirm(false)}
        >
          <div
            className="bg-white rounded-2xl p-5 max-w-md w-full space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900">Re-run AI review?</h2>
            <p className="text-[12px] text-gray-600">
              This will overwrite the current AI analysis with a fresh review that uses Acceptable Fallback
              language for {secondRoundClauses.length === 0
                ? 'no clauses'
                : `clause${secondRoundClauses.length === 1 ? '' : 's'} ${[...secondRoundClauses].sort().map((c) => `§${c}`).join(', ')}`}.
              Your saved per-clause decisions will remain, but if the new analysis returns a different number of
              changes you may need to re-decide some clauses. The counter-PDF (if any) is not affected until you regenerate it.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowRerunConfirm(false)}
                disabled={rerunning}
                className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 text-[12px] font-bold rounded-xl disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runRerun}
                disabled={rerunning}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[12px] font-bold rounded-xl"
              >
                {rerunning ? 'Re-running…' : 'Re-run AI review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate confirmation modal */}
      {showRegenerateConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !generating && setShowRegenerateConfirm(false)}
        >
          <div
            className="bg-white rounded-2xl p-5 max-w-md w-full space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900">Regenerate counter-PDF?</h2>
            <p className="text-[12px] text-gray-600">
              This will replace the previous counter-PDF (generated {fmtDateTime(record.counterGeneratedAt)})
              with a fresh one based on your current decisions. The previous version will not be kept.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowRegenerateConfirm(false)}
                disabled={generating}
                className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 text-[12px] font-bold rounded-xl disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runGenerate}
                disabled={generating}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[12px] font-bold rounded-xl"
              >
                {generating ? 'Regenerating…' : 'Replace and regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
