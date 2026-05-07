'use client';
import { useState } from 'react';

const TYPE_CONFIG = {
  auto_approved: { color: 'bg-emerald-50 border-emerald-200 text-emerald-800', icon: '✓', badge: 'bg-emerald-100 text-emerald-700', label: 'Auto-approved' },
  needs_review: { color: 'bg-amber-50 border-amber-200 text-amber-800', icon: '⚠', badge: 'bg-amber-100 text-amber-700', label: 'Needs review' },
  not_acceptable: { color: 'bg-red-50 border-red-200 text-red-700', icon: '✗', badge: 'bg-red-100 text-red-700', label: 'Not acceptable' },
};

interface ReviewResultPanelProps {
  review: any;
}

export function ReviewResultPanel({ review }: ReviewResultPanelProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!review) return null;

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
          return (
            <div key={i} className={`rounded-xl border p-3 ${cfg.color}`}>
              <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={() => setExpanded(expanded === i ? null : i)}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-bold text-sm flex-shrink-0">{cfg.icon}</span>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold flex items-center gap-1.5">
                      {change.clause && <span className="opacity-50">§{change.clause}</span>}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${cfg.badge}`}>{cfg.label}</span>
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
