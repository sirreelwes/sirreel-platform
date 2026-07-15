'use client';
import { useState } from 'react';
import { CANONICAL_CLAUSES } from '@/lib/contracts/contractClauses';
import { clauseMatches, type MarkupManifest } from '@/lib/contracts/annotationManifest';

const BASELINE_BY_REF = new Map(CANONICAL_CLAUSES.map((c) => [c.ref, c]));

const TYPE_CONFIG = {
  auto_approved: { color: 'bg-emerald-50 border-emerald-200 text-emerald-800', icon: '✓', badge: 'bg-emerald-100 text-emerald-700', label: 'Auto-approved' },
  needs_review: { color: 'bg-amber-50 border-amber-200 text-amber-800', icon: '⚠', badge: 'bg-amber-100 text-amber-700', label: 'Needs review' },
  not_acceptable: { color: 'bg-red-50 border-red-200 text-red-700', icon: '✗', badge: 'bg-red-100 text-red-700', label: 'Not acceptable' },
};

export type ClauseDecisionValue = 'PENDING' | 'ACCEPT' | 'COUNTER' | 'REJECT';

export interface DecisionState {
  decision: ClauseDecisionValue;
  counterLanguage: string;
  note: string;
}

const DECISION_BTN: Record<Exclude<ClauseDecisionValue, 'PENDING'>, { label: string; idle: string; active: string }> = {
  ACCEPT: {
    label: '✓ Accept',
    idle: 'bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50',
    active: 'bg-emerald-600 text-white border border-emerald-600',
  },
  COUNTER: {
    label: '↩ Counter',
    idle: 'bg-white border border-amber-300 text-amber-700 hover:bg-amber-50',
    active: 'bg-amber-500 text-white border border-amber-500',
  },
  REJECT: {
    label: '✗ Reject',
    idle: 'bg-white border border-red-300 text-red-700 hover:bg-red-50',
    active: 'bg-red-600 text-white border border-red-600',
  },
};

const DECISION_BADGE: Record<ClauseDecisionValue, { label: string; cls: string }> = {
  PENDING: { label: 'Pending', cls: 'bg-gray-200 text-gray-600' },
  ACCEPT: { label: 'Accept', cls: 'bg-emerald-600 text-white' },
  COUNTER: { label: 'Counter', cls: 'bg-amber-500 text-white' },
  REJECT: { label: 'Reject', cls: 'bg-red-600 text-white' },
};

/** One persisted Discuss message, as serialized by the API. */
export interface DiscussMessage {
  id: string;
  clauseKey: string;
  role: string;
  content: string;
  createdAt: string;
  createdBy?: { id: string; name: string } | null;
}

interface ReviewResultPanelProps {
  review: any;
  /** When provided, per-clause decision controls render. Keyed by changeIndex. */
  decisions?: Record<number, DecisionState>;
  onDecisionChange?: (changeIndex: number, next: DecisionState) => void;
  /** Clause refs the operator has marked for second-round negotiation. Drives the per-clause toggle UI. */
  secondRoundClauses?: string[];
  onToggleSecondRound?: (clauseRef: string, next: boolean) => void;
  /**
   * Deterministic PDF markup extraction (strikes + insertions). When
   * present, each clause card shows the raw ground truth next to the
   * AI's transcription so the reviewer can spot divergence.
   */
  manifest?: MarkupManifest | null;
  /** Enables the per-clause Discuss thread (POST [id]/discuss). */
  reviewId?: string;
  /** Persisted Discuss messages for the whole review (all clause keys). */
  discussions?: DiscussMessage[];
}

/** Thread key for a change — its clause ref, or "#<index>" when empty. */
function discussKeyFor(change: any, changeIndex: number): string {
  const ref = String(change?.clause ?? '').trim();
  return ref || `#${changeIndex}`;
}

export function ReviewResultPanel({
  review,
  decisions,
  onDecisionChange,
  secondRoundClauses,
  onToggleSecondRound,
  manifest,
  reviewId,
  discussions,
}: ReviewResultPanelProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [baselineOpen, setBaselineOpen] = useState<Record<number, boolean>>({});
  // Discuss threads keyed by clauseKey; seeded from the persisted
  // messages once, then appended to locally as turns complete.
  const [threads, setThreads] = useState<Record<string, DiscussMessage[]>>(() => {
    const grouped: Record<string, DiscussMessage[]> = {};
    for (const m of discussions || []) (grouped[m.clauseKey] ||= []).push(m);
    return grouped;
  });
  const appendToThread = (clauseKey: string, msgs: DiscussMessage[]) =>
    setThreads((prev) => ({ ...prev, [clauseKey]: [...(prev[clauseKey] || []), ...msgs] }));

  if (!review) return null;
  const interactive = !!decisions && !!onDecisionChange;
  const secondRoundSet = new Set((secondRoundClauses || []).map((s) => s.trim()));
  const secondRoundEditable = !!onToggleSecondRound;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className={`rounded-2xl p-5 border ${
        review.recommendation === 'reject' ? 'bg-red-50 border-red-200' :
        'bg-amber-50 border-amber-200'
      }`}>
        <div className="flex items-start gap-4">
          <div className="text-3xl">{review.recommendation === 'reject' ? '❌' : '📋'}</div>
          <div className="flex-1">
            <div className={`text-base font-bold ${review.recommendation === 'reject' ? 'text-red-700' : 'text-amber-800'}`}>
              AI Recommendation: {review.recommendation === 'reject' ? 'Reject' : 'Counter-propose'}
            </div>
            <p className="text-sm mt-1 text-gray-600">{review.summary}</p>
            <div className="flex gap-3 mt-2 text-[11px]">
              <span className="text-emerald-600 font-semibold">✓ {review.autoApprovedCount} auto-approved</span>
              <span className="text-amber-600 font-semibold">⚠ {review.needsReviewCount} needs review</span>
              <span className="text-red-600 font-semibold">✗ {review.notAcceptableCount} not acceptable</span>
            </div>
          </div>
          <div className={`text-[10px] font-bold px-2.5 py-1 rounded-lg flex-shrink-0 ${
            review.riskLevel === 'high' ? 'bg-red-100 text-red-700' :
            review.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' :
            'bg-emerald-100 text-emerald-700'
          }`}>{review.riskLevel?.toUpperCase()} RISK</div>
        </div>
      </div>

      {/* Changes */}
      <div className="space-y-2">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Proposed Changes ({review.changes?.length || 0})</div>
        {review.changes?.map((change: any, i: number) => {
          const cfg = TYPE_CONFIG[change.type as keyof typeof TYPE_CONFIG] || TYPE_CONFIG.needs_review;
          const decision = decisions?.[i] ?? { decision: 'PENDING' as ClauseDecisionValue, counterLanguage: '', note: '' };
          const badge = DECISION_BADGE[decision.decision];
          const clauseRef = String(change.clause || '').trim();
          const isSecondRound = clauseRef ? secondRoundSet.has(clauseRef) : false;
          const needsOperatorReview = change.needsOperatorReview === true;
          return (
            <div key={i} className={`rounded-xl border p-3 ${cfg.color}`}>
              <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={() => setExpanded(expanded === i ? null : i)}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-bold text-sm flex-shrink-0">{cfg.icon}</span>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold flex items-center gap-1.5 flex-wrap">
                      {change.clause && <span className="opacity-50">§{change.clause}</span>}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${cfg.badge}`}>{cfg.label}</span>
                      {needsOperatorReview && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-red-600 text-white">
                          ⚠️ Needs operator review
                        </span>
                      )}
                      {isSecondRound && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-indigo-100 text-indigo-700">
                          Second-round
                        </span>
                      )}
                      {interactive && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${badge.cls}`}>{badge.label}</span>
                      )}
                    </div>
                    <div className="text-[11px] opacity-70 truncate mt-0.5">{change.description ?? change.proposed}</div>
                  </div>
                </div>
                <span className="text-[10px] opacity-40 flex-shrink-0">{expanded === i ? '▲' : '▼'}</span>
              </div>
              {expanded === i && (
                <div className="mt-3 pt-3 border-t border-current border-opacity-20 space-y-2 text-[11px]">
                  {needsOperatorReview && change.operatorReviewReason && (
                    <div className="bg-red-50 border border-red-300 rounded-lg p-2.5">
                      <div className="font-bold text-red-700 uppercase text-[9px] mb-1">⚠️ Operator review reason</div>
                      <div className="text-red-700 leading-relaxed">{change.operatorReviewReason}</div>
                    </div>
                  )}
                  {secondRoundEditable && clauseRef && (
                    <div className="bg-white/50 rounded-lg p-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold opacity-60 uppercase text-[9px] mb-0.5">Second-round negotiation</div>
                        <div className="text-[10px] opacity-70 leading-snug">
                          When on, the AI sources this clause's counter from the playbook's Acceptable Fallback (not Preferred).
                          Toggling won&apos;t change the current suggestion — click &quot;Re-run AI&quot; below to apply.
                        </div>
                      </div>
                      <label
                        className="flex items-center gap-2 cursor-pointer flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSecondRound}
                          onChange={(e) => onToggleSecondRound!(clauseRef, e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span className="text-[11px] font-semibold">{isSecondRound ? 'On' : 'Off'}</span>
                      </label>
                    </div>
                  )}
                  {change.description && (
                    <div><div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">Summary</div><div>{change.description}</div></div>
                  )}
                  <div><div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">Original</div><div>{change.original}</div></div>
                  <div>
                    <div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">Client proposed (AI-transcribed)</div>
                    <div className="text-[10px] opacity-60 mb-1">The AI&apos;s read of the client&apos;s post-redline clause. Rendered verbatim into the counter-PDF if you Accept — check it against the markup ground truth below.</div>
                    <div className="bg-white/50 rounded-lg p-2">{change.proposed || <span className="opacity-50 italic">No clause text extracted.</span>}</div>
                  </div>
                  <ClauseMarkupGroundTruth manifest={manifest} clauseRef={clauseRef} />
                  <div><div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">Reasoning</div><div className="opacity-80">{change.reasoning}</div></div>
                  {change.suggestedCounter && (
                    <div className="bg-white/50 rounded-lg p-2">
                      <div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">Suggested Counter</div>
                      <div>{change.suggestedCounter}</div>
                    </div>
                  )}

                  {/* Per-clause Discuss thread — internal only, nothing
                      here reaches the client. Applying a draft is an
                      explicit click that seeds the COUNTER decision. */}
                  {reviewId && change.type !== 'auto_approved' && (
                    <DiscussPanel
                      reviewId={reviewId}
                      clauseKey={discussKeyFor(change, i)}
                      changeIndex={i}
                      messages={threads[discussKeyFor(change, i)] || []}
                      onNewMessages={(msgs) => appendToThread(discussKeyFor(change, i), msgs)}
                      onApplyCounter={
                        interactive
                          ? (draft) =>
                              onDecisionChange!(i, {
                                decision: 'COUNTER',
                                counterLanguage: draft,
                                note: decision.note,
                              })
                          : undefined
                      }
                    />
                  )}

                  {interactive && (
                    <div className="mt-3 pt-3 border-t border-current border-opacity-20 space-y-2">
                      <div className="font-bold opacity-60 uppercase text-[9px]">Your Decision</div>
                      <div className="flex gap-1.5">
                        {(['ACCEPT', 'COUNTER', 'REJECT'] as const).map((kind) => {
                          const active = decision.decision === kind;
                          const style = active ? DECISION_BTN[kind].active : DECISION_BTN[kind].idle;
                          return (
                            <button
                              key={kind}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const ref = String(change.clause || '').trim();
                                const baselineBody = BASELINE_BY_REF.get(ref)?.body || '';
                                const seed =
                                  change.suggestedCounter ||
                                  baselineBody ||
                                  '';
                                const next: DecisionState = {
                                  decision: kind,
                                  counterLanguage:
                                    kind === 'COUNTER' && !decision.counterLanguage
                                      ? seed
                                      : decision.counterLanguage,
                                  note: decision.note,
                                };
                                onDecisionChange!(i, next);
                              }}
                              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg ${style}`}
                            >
                              {DECISION_BTN[kind].label}
                            </button>
                          );
                        })}
                      </div>
                      {decision.decision === 'COUNTER' && (() => {
                        const ref = String(change.clause || '').trim();
                        const baseline = BASELINE_BY_REF.get(ref);
                        const refLabel = ref ? `§${ref}` : 'this clause';
                        const isBaselineOpen = !!baselineOpen[i];
                        return (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              {baseline ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBaselineOpen((prev) => ({ ...prev, [i]: !prev[i] }));
                                  }}
                                  className="text-[11px] font-semibold text-gray-600 hover:text-gray-900 flex items-center gap-1"
                                >
                                  <span className="text-[8px]">{isBaselineOpen ? '▼' : '▶'}</span>
                                  {isBaselineOpen ? 'Hide' : 'Show'} baseline {refLabel}
                                </button>
                              ) : (
                                <span className="text-[10px] text-gray-400 italic">
                                  No single baseline clause for {refLabel} (grouped or non-numbered)
                                </span>
                              )}
                              {change.suggestedCounter && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDecisionChange!(i, {
                                      ...decision,
                                      counterLanguage: change.suggestedCounter || '',
                                    });
                                  }}
                                  className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 underline decoration-dotted"
                                >
                                  ↺ Reset to AI suggestion
                                </button>
                              )}
                            </div>

                            {baseline && isBaselineOpen && (
                              <div className="bg-white border border-gray-200 rounded-lg p-2.5 text-[11px] text-gray-700 leading-relaxed">
                                <div className="font-bold text-gray-500 uppercase text-[9px] mb-1">
                                  Baseline §{baseline.ref} — {baseline.title}
                                </div>
                                <div>{baseline.body}</div>
                              </div>
                            )}

                            <div>
                              <div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">
                                Counter clause text
                              </div>
                              <div className="text-[10px] text-gray-500 mb-1">
                                This exact text will appear in {refLabel} of the counter-PDF.
                                Write a complete contract clause in the same voice as the baseline.
                              </div>
                              <textarea
                                value={decision.counterLanguage}
                                onChange={(e) =>
                                  onDecisionChange!(i, { ...decision, counterLanguage: e.target.value })
                                }
                                onClick={(e) => e.stopPropagation()}
                                rows={5}
                                placeholder="Replacement clause text — written as binding legal language, not strategy…"
                                className="w-full bg-white border border-gray-300 rounded-lg p-2 text-[11px] text-gray-900 resize-y focus:outline-none focus:border-amber-500"
                              />
                            </div>

                            {change.counterReasoning && (
                              <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                                <div className="font-bold text-gray-500 uppercase text-[9px] mb-1">
                                  AI&apos;s reasoning (not included in PDF)
                                </div>
                                <div className="text-[11px] text-gray-600 leading-relaxed">
                                  {change.counterReasoning}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <div>
                        <div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">Note (optional)</div>
                        <textarea
                          value={decision.note}
                          onChange={(e) =>
                            onDecisionChange!(i, { ...decision, note: e.target.value })
                          }
                          onClick={(e) => e.stopPropagation()}
                          rows={2}
                          placeholder="Why this decision…"
                          className="w-full bg-white border border-gray-300 rounded-lg p-2 text-[11px] text-gray-900 resize-none focus:outline-none focus:border-gray-400"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Per-clause Discuss thread ──────────────────────────────────────

const COUNTER_DRAFT_RE = /<counter-draft>([\s\S]*?)<\/counter-draft>/g;

/** Split assistant content into prose and counter-draft segments. */
function parseAssistantContent(content: string): Array<{ kind: 'text' | 'draft'; text: string }> {
  const segments: Array<{ kind: 'text' | 'draft'; text: string }> = [];
  let last = 0;
  for (const m of content.matchAll(COUNTER_DRAFT_RE)) {
    const before = content.slice(last, m.index).trim();
    if (before) segments.push({ kind: 'text', text: before });
    const draft = m[1].trim();
    if (draft) segments.push({ kind: 'draft', text: draft });
    last = (m.index ?? 0) + m[0].length;
  }
  const tail = content.slice(last).trim();
  if (tail) segments.push({ kind: 'text', text: tail });
  return segments.length > 0 ? segments : [{ kind: 'text', text: content }];
}

function DiscussPanel({
  reviewId,
  clauseKey,
  changeIndex,
  messages,
  onNewMessages,
  onApplyCounter,
}: {
  reviewId: string;
  clauseKey: string;
  changeIndex: number;
  messages: DiscussMessage[];
  onNewMessages: (msgs: DiscussMessage[]) => void;
  /** Absent in read-only contexts — the Apply button hides. */
  onApplyCounter?: (draft: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedFor, setAppliedFor] = useState<string | null>(null);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tools/contract-review/${reviewId}/discuss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clauseKey, changeIndex, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to send');
        return;
      }
      onNewMessages([data.userMessage, data.assistantMessage]);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2.5 py-2 text-left"
      >
        <span className="font-bold text-gray-500 uppercase text-[9px]">
          💬 Discuss with Claude{messages.length > 0 ? ` (${messages.length})` : ''}
        </span>
        <span className="text-[10px] text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <div className="text-[10px] text-gray-400 leading-snug">
            Internal discussion — nothing here is sent to the client. Ask about this clause, test
            positions, or request draft counter language; drafts get an explicit Apply button.
          </div>
          {messages.length > 0 && (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {messages.map((m) =>
                m.role === 'assistant' ? (
                  <div key={m.id} className="bg-gray-50 border border-gray-200 rounded-lg p-2 space-y-1.5 mr-6">
                    {parseAssistantContent(m.content).map((seg, si) =>
                      seg.kind === 'text' ? (
                        <div key={si} className="text-[11px] text-gray-700 whitespace-pre-wrap leading-relaxed">
                          {seg.text}
                        </div>
                      ) : (
                        <div key={si} className="border border-amber-300 bg-amber-50 rounded-lg p-2 space-y-1.5">
                          <div className="font-bold text-amber-700 uppercase text-[9px]">Draft counter clause</div>
                          <div className="text-[11px] text-gray-800 whitespace-pre-wrap leading-relaxed">{seg.text}</div>
                          {onApplyCounter && (
                            <button
                              type="button"
                              onClick={() => {
                                onApplyCounter(seg.text);
                                setAppliedFor(`${m.id}:${si}`);
                              }}
                              className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600"
                            >
                              {appliedFor === `${m.id}:${si}`
                                ? '✓ Applied — review & save your decision'
                                : 'Apply as Counter text'}
                            </button>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <div key={m.id} className="bg-sky-50 border border-sky-100 rounded-lg p-2 ml-6">
                    <div className="text-[9px] font-semibold text-sky-700 mb-0.5">
                      {m.createdBy?.name || 'Operator'}
                    </div>
                    <div className="text-[11px] text-gray-700 whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  </div>
                ),
              )}
            </div>
          )}
          {error && <div className="text-[10px] text-red-600 font-semibold">{error}</div>}
          <div className="flex gap-1.5 items-end">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="Ask about this clause, or request draft counter language… (⌘↵ to send)"
              className="flex-1 bg-white border border-gray-300 rounded-lg p-2 text-[11px] text-gray-900 resize-y focus:outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              className="text-[11px] font-bold px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-40"
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Raw markup ground truth for one clause — the verbatim spans the
 * client physically struck and the notes they inserted, straight from
 * the PDF annotation objects (no AI involved). Renders nothing when the
 * manifest is absent or has no entries for this clause.
 */
function ClauseMarkupGroundTruth({
  manifest,
  clauseRef,
}: {
  manifest: MarkupManifest | null | undefined;
  clauseRef: string;
}) {
  if (!manifest || !clauseRef) return null;
  const struck = manifest.struck.filter((s) => clauseMatches(s.clauseGuess, clauseRef));
  const inserted = manifest.inserted.filter((n) => clauseMatches(n.clauseGuess, clauseRef));
  if (struck.length === 0 && inserted.length === 0) return null;
  return (
    <div className="bg-white border border-gray-300 rounded-lg p-2.5">
      <div className="font-bold text-gray-500 uppercase text-[9px] mb-1">
        Markup ground truth (extracted from PDF annotations)
      </div>
      {struck.length > 0 && (
        <div className="space-y-0.5 mb-1.5">
          <div className="text-[9px] font-semibold text-red-600 uppercase">Client struck</div>
          {struck.map((s, idx) => (
            <div key={idx} className="text-[11px] text-gray-700">
              <span className="line-through decoration-red-500 decoration-2">{s.text}</span>
              <span className="text-gray-400 ml-1.5 text-[9px]">p{s.page}</span>
            </div>
          ))}
        </div>
      )}
      {inserted.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[9px] font-semibold text-emerald-700 uppercase">Client inserted</div>
          {inserted.map((n, idx) => (
            <div key={idx} className="text-[11px] text-emerald-800">
              “{n.text}”
              <span className="text-gray-400 ml-1.5 text-[9px]">p{n.page}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
