'use client';

import { useState } from 'react';

const RISK_COLORS = {
  auto_approved: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  needs_review: 'bg-amber-50 border-amber-200 text-amber-800',
  not_acceptable: 'bg-red-50 border-red-200 text-red-700',
};

const RISK_ICONS = {
  auto_approved: '✓',
  needs_review: '⚠',
  not_acceptable: '✗',
};

const RISK_LABELS = {
  auto_approved: 'Auto-approved',
  needs_review: 'Needs review',
  not_acceptable: 'Not acceptable',
};

export default function RedlineReview({ review, token, onStatusChange }: {
  review: any;
  token: string;
  onStatusChange?: (status: string) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [counterText, setCounterText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!review) return null;

  const sendCounter = async () => {
    setSending(true);
    try {
      await fetch(`/api/portal/${token}/contract/counter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counterText, review })
      });
      setSent(true);
      onStatusChange?.('counter_sent');
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className={`rounded-xl p-4 border ${
        review.recommendation === 'approve' ? 'bg-emerald-50 border-emerald-200' :
        review.recommendation === 'reject' ? 'bg-red-50 border-red-200' :
        'bg-amber-50 border-amber-200'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">
              {review.recommendation === 'approve' ? '✅' : review.recommendation === 'reject' ? '❌' : '📋'}
            </span>
            <div>
              <div className={`text-sm font-bold ${
                review.recommendation === 'approve' ? 'text-emerald-800' :
                review.recommendation === 'reject' ? 'text-red-700' : 'text-amber-800'
              }`}>
                AI Recommendation: {review.recommendation === 'approve' ? 'Approve' : review.recommendation === 'reject' ? 'Reject' : 'Counter-propose'}
              </div>
              <div className="text-[11px] text-gray-600 mt-0.5">{review.recommendationNote}</div>
            </div>
          </div>
          <div className={`text-[10px] font-bold px-2 py-1 rounded-lg flex-shrink-0 ${
            review.riskLevel === 'low' ? 'bg-emerald-100 text-emerald-700' :
            review.riskLevel === 'high' ? 'bg-red-100 text-red-700' :
            'bg-amber-100 text-amber-700'
          }`}>
            {review.riskLevel?.toUpperCase()} RISK
          </div>
        </div>
        <p className="text-[11px] text-gray-600 mt-2 leading-relaxed">{review.summary}</p>
        <div className="flex gap-3 mt-3 text-[11px]">
          <span className="text-emerald-700 font-semibold">✓ {review.autoApprovedCount} auto-approved</span>
          <span className="text-amber-700 font-semibold">⚠ {review.needsReviewCount} needs review</span>
          <span className="text-red-700 font-semibold">✗ {review.notAcceptableCount} not acceptable</span>
        </div>
      </div>

      {/* Changes list */}
      <div className="space-y-2">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Proposed Changes ({review.changes?.length || 0})</div>
        {review.changes?.map((change: any, i: number) => (
          <div key={i} className={`rounded-xl border p-3 ${RISK_COLORS[change.type as keyof typeof RISK_COLORS] || 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={() => setExpanded(expanded === i ? null : i)}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-sm font-bold flex-shrink-0">{RISK_ICONS[change.type as keyof typeof RISK_ICONS]}</span>
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold truncate">
                    {change.clause && <span className="opacity-60 mr-1">§{change.clause}</span>}
                    {RISK_LABELS[change.type as keyof typeof RISK_LABELS]}
                  </div>
                  <div className="text-[10px] opacity-70 truncate">{change.proposed}</div>
                </div>
              </div>
              <span className="text-[10px] opacity-50 flex-shrink-0">{expanded === i ? '▲' : '▼'}</span>
            </div>

            {expanded === i && (
              <div className="mt-3 pt-3 border-t border-current border-opacity-20 space-y-2 text-[11px]">
                <div>
                  <div className="font-bold opacity-60 uppercase text-[9px] mb-0.5">Original</div>
                  <div className="leading-relaxed">{change.original}</div>
                </div>
                <div>
                  <div className="font-bold opacity-60 uppercase text-[9px] mb-0.5">Client Proposed</div>
                  <div className="leading-relaxed">{change.proposed}</div>
                </div>
                <div>
                  <div className="font-bold opacity-60 uppercase text-[9px] mb-0.5">Reasoning</div>
                  <div className="leading-relaxed opacity-80">{change.reasoning}</div>
                </div>
                {change.suggestedCounter && (
                  <div className="bg-white/50 rounded-lg p-2">
                    <div className="font-bold opacity-60 uppercase text-[9px] mb-0.5">Suggested Counter</div>
                    <div className="leading-relaxed">{change.suggestedCounter}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action buttons */}
      {!sent && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Send Response to Client</div>
          <textarea
            value={counterText}
            onChange={e => setCounterText(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[12px] resize-none focus:outline-none focus:border-gray-400"
            rows={3}
            placeholder="Add a note to the client about your response (optional)..."
          />
          <div className="flex gap-2">
            <button
              onClick={async () => {
                setSending(true);
                try {
                  await fetch(`/api/portal/${token}/contract/counter`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'approve', counterText })
                  });
                  setSent(true);
                  onStatusChange?.('approved');
                } finally { setSending(false); }
              }}
              disabled={sending}
              className="flex-1 py-2.5 bg-emerald-600 text-white text-[12px] font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors"
            >
              Approve Changes
            </button>
            <button
              onClick={sendCounter}
              disabled={sending}
              className="flex-1 py-2.5 bg-amber-500 text-white text-[12px] font-semibold rounded-xl hover:bg-amber-600 disabled:opacity-40 transition-colors"
            >
              Send Counter
            </button>
            <button
              onClick={async () => {
                setSending(true);
                try {
                  await fetch(`/api/portal/${token}/contract/counter`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'reject', counterText })
                  });
                  setSent(true);
                  onStatusChange?.('rejected');
                } finally { setSending(false); }
              }}
              disabled={sending}
              className="flex-1 py-2.5 bg-red-600 text-white text-[12px] font-semibold rounded-xl hover:bg-red-700 disabled:opacity-40 transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {sent && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center text-sm text-emerald-700 font-semibold">
          ✓ Response sent to client
        </div>
      )}
    </div>
  );
}
