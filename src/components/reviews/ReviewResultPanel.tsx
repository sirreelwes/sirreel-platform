'use client';
import { useState } from 'react';
import { CANONICAL_CLAUSES } from '@/lib/contracts/contractClauses';

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

interface ReviewResultPanelProps {
  review: any;
  /** When provided, per-clause decision controls render. Keyed by changeIndex. */
  decisions?: Record<number, DecisionState>;
  onDecisionChange?: (changeIndex: number, next: DecisionState) => void;
}

export function ReviewResultPanel({ review, decisions, onDecisionChange }: ReviewResultPanelProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [baselineOpen, setBaselineOpen] = useState<Record<number, boolean>>({});

  if (!review) return null;
  const interactive = !!decisions && !!onDecisionChange;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className={`rounded-2xl p-5 border ${
        review.recommendation === 'approve' ? 'bg-emerald-50 border-emerald-200' :
        review.recommendation === 'reject' ? 'bg-red-50 border-red-200' :
        'bg-amber-50 border-amber-200'
      }`}>
        <div className="flex items-start gap-4">
          <div className="text-3xl">{review.recommendation === 'approve' ? '✅' : review.recommendation === 'reject' ? '❌' : '📋'}</div>
          <div className="flex-1">
            <div className={`text-base font-bold ${review.recommendation === 'approve' ? 'text-emerald-800' : review.recommendation === 'reject' ? 'text-red-700' : 'text-amber-800'}`}>
              AI Recommendation: {review.recommendation === 'approve' ? 'Approve' : review.recommendation === 'reject' ? 'Reject' : 'Counter-propose'}
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
          return (
            <div key={i} className={`rounded-xl border p-3 ${cfg.color}`}>
              <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={() => setExpanded(expanded === i ? null : i)}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-bold text-sm flex-shrink-0">{cfg.icon}</span>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold flex items-center gap-1.5 flex-wrap">
                      {change.clause && <span className="opacity-50">§{change.clause}</span>}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${cfg.badge}`}>{cfg.label}</span>
                      {interactive && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${badge.cls}`}>{badge.label}</span>
                      )}
                    </div>
                    <div className="text-[11px] opacity-70 truncate mt-0.5">{change.proposed}</div>
                  </div>
                </div>
                <span className="text-[10px] opacity-40 flex-shrink-0">{expanded === i ? '▲' : '▼'}</span>
              </div>
              {expanded === i && (
                <div className="mt-3 pt-3 border-t border-current border-opacity-20 space-y-2 text-[11px]">
                  <div><div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">Original</div><div>{change.original}</div></div>
                  <div><div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">Proposed</div><div>{change.proposed}</div></div>
                  <div><div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">Reasoning</div><div className="opacity-80">{change.reasoning}</div></div>
                  {change.suggestedCounter && (
                    <div className="bg-white/50 rounded-lg p-2">
                      <div className="font-bold opacity-50 uppercase text-[9px] mb-0.5">Suggested Counter</div>
                      <div>{change.suggestedCounter}</div>
                    </div>
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
                                const next: DecisionState = {
                                  decision: kind,
                                  counterLanguage:
                                    kind === 'COUNTER' && !decision.counterLanguage
                                      ? (change.suggestedCounter || '')
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
