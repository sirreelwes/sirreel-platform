'use client';
import { useState, useEffect } from 'react';

function timeAgo(d: string) {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const h = Math.floor(diff / 3600000);
  if (h > 24) return `${Math.floor(h/24)}d ago`;
  if (h > 0) return `${h}h ago`;
  return `${Math.floor(diff/60000)}m ago`;
}

export default function ReviewsWidget() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const load = () => {
    fetch('/api/reviews')
      .then(r => r.json())
      .then(d => { setReviews(d.reviews || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const pending = reviews.filter(r => !done.has(r.id));

  const approveCoi = async (token: string, note: string) => {
    setActing(token + '_coi');
    try {
      await fetch(`/api/portal/${token}/coi-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'Admin', note })
      });
      setDone(d => new Set([...d, reviews.find(r => r.token === token)?.id]));
      setExpanded(null);
    } finally { setActing(null); }
  };

  const actRedline = async (token: string, action: string, note: string) => {
    setActing(token + '_redline');
    try {
      await fetch(`/api/portal/${token}/contract/counter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, counterText: note })
      });
      setDone(d => new Set([...d, reviews.find(r => r.token === token)?.id]));
      setExpanded(null);
    } finally { setActing(null); }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-base">📋</span>
          <span className="text-sm font-bold text-gray-900">Pending Reviews</span>
          {pending.length > 0 && (
            <span className="w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{pending.length}</span>
          )}
        </div>
        <button onClick={load} className="text-[11px] text-blue-600 font-semibold hover:underline">Refresh</button>
      </div>

      {loading ? (
        <div className="p-5 text-center text-sm text-gray-400">Loading...</div>
      ) : pending.length === 0 ? (
        <div className="p-5 text-center">
          <div className="text-2xl mb-2">✅</div>
          <div className="text-sm text-gray-500">No pending reviews</div>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {pending.map(review => (
            <div key={review.id} className="p-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold text-gray-900">{review.companyName}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{review.bookingNumber}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">{review.jobName}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {review.coi?.type === 'needs_admin_approval' && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">⚠ COI Approval</span>
                  )}
                  {review.coi?.type === 'hard_fail' && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">✗ COI Failed</span>
                  )}
                  {review.redline && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">📝 Redline</span>
                  )}
                  <span className="text-[9px] text-gray-400">{timeAgo(review.redline?.uploadedAt || review.coi?.reviewedAt)}</span>
                </div>
              </div>

              {/* COI summary */}
              {review.coi && (
                <div className={`rounded-xl p-3 mb-2 ${review.coi.type === 'needs_admin_approval' ? 'bg-amber-50 border border-amber-100' : 'bg-red-50 border border-red-100'}`}>
                  <div className={`text-[11px] font-bold mb-1 ${review.coi.type === 'needs_admin_approval' ? 'text-amber-800' : 'text-red-700'}`}>
                    {review.coi.type === 'needs_admin_approval' ? '⚠ All required coverages pass — manageable items need your sign-off' : '✗ COI hard fails — client must correct and resubmit'}
                  </div>
                  {review.coi.review?.insuredName?.found && (
                    <div className="text-[10px] text-gray-500">Insured: <span className="font-semibold">{review.coi.review.insuredName.found}</span></div>
                  )}
                  {review.coi.type === 'needs_admin_approval' && review.coi.review?.manageableIssues?.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {review.coi.review.manageableIssues.map((issue: string, i: number) => (
                        <li key={i} className="text-[10px] text-amber-700">• {issue}</li>
                      ))}
                    </ul>
                  )}
                  {review.coi.type === 'hard_fail' && review.coi.review?.hardIssues?.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {review.coi.review.hardIssues.map((issue: string, i: number) => (
                        <li key={i} className="text-[10px] text-red-600">• {issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Redline summary */}
              {review.redline?.review && (
                <div className={`rounded-xl p-3 mb-2 ${review.redline.review.recommendation === 'approve' ? 'bg-emerald-50 border border-emerald-100' : review.redline.review.recommendation === 'reject' ? 'bg-red-50 border border-red-100' : 'bg-amber-50 border border-amber-100'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[11px] font-bold text-gray-800">
                      AI: {review.redline.review.recommendation === 'approve' ? '✅ Approve' : review.redline.review.recommendation === 'reject' ? '❌ Reject' : '📋 Counter'}
                    </div>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${review.redline.review.riskLevel === 'high' ? 'bg-red-100 text-red-700' : review.redline.review.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {review.redline.review.riskLevel?.toUpperCase()} RISK
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-600 leading-relaxed">{review.redline.review.summary}</p>
                  <div className="flex gap-2 mt-1 text-[10px]">
                    <span className="text-emerald-600">✓ {review.redline.review.autoApprovedCount}</span>
                    <span className="text-amber-600">⚠ {review.redline.review.needsReviewCount}</span>
                    <span className="text-red-600">✗ {review.redline.review.notAcceptableCount}</span>
                  </div>
                </div>
              )}

              {/* Expand button */}
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => setExpanded(expanded === review.id ? null : review.id)}
                  className="flex-1 py-1.5 border border-gray-200 rounded-lg text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                  {expanded === review.id ? 'Hide ▲' : 'Review & Act ▼'}
                </button>
                <a href={`/portal/${review.token}`} target="_blank"
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                  Portal ↗
                </a>
              </div>

              {/* Expanded action panel */}
              {expanded === review.id && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">

                  {/* Redline changes detail */}
                  {review.redline?.review?.changes?.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Proposed Changes</div>
                      {review.redline.review.changes.map((change: any, i: number) => (
                        <div key={i} className={`p-2.5 rounded-xl text-[11px] border ${
                          change.type === 'auto_approved' ? 'bg-emerald-50 border-emerald-100' :
                          change.type === 'not_acceptable' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'
                        }`}>
                          <div className="font-semibold mb-0.5">
                            {change.type === 'auto_approved' ? '✓' : change.type === 'not_acceptable' ? '✗' : '⚠'}
                            {' '}§{change.clause}
                          </div>
                          <div className="opacity-70">{change.proposed}</div>
                          {change.suggestedCounter && (
                            <div className="mt-1 text-[10px] opacity-60 italic">Counter: {change.suggestedCounter}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Note field */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                      {review.coi?.type === 'needs_admin_approval' ? 'Approval note (explain what you\'re signing off on)' : 'Note to client'}
                    </label>
                    <textarea
                      value={notes[review.id] || ''}
                      onChange={e => setNotes(n => ({ ...n, [review.id]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl p-2.5 text-[11px] resize-none focus:outline-none focus:border-gray-400"
                      rows={2}
                      placeholder={review.coi?.type === 'needs_admin_approval'
                        ? 'e.g. "Approved without umbrella — short shoot, GL limits are sufficient"'
                        : 'Optional note for the client...'}
                    />
                  </div>

                  {/* COI approve button */}
                  {review.coi?.type === 'needs_admin_approval' && (
                    <button
                      onClick={() => approveCoi(review.token, notes[review.id] || '')}
                      disabled={acting === review.token + '_coi'}
                      className="w-full py-2.5 bg-amber-500 text-white text-[12px] font-bold rounded-xl hover:bg-amber-600 disabled:opacity-40 transition-colors"
                    >
                      {acting === review.token + '_coi' ? 'Approving...' : '✓ Approve COI with Exceptions'}
                    </button>
                  )}

                  {/* Redline action buttons */}
                  {review.redline && (
                    <div className="flex gap-2">
                      <button onClick={() => actRedline(review.token, 'approve', notes[review.id] || '')}
                        disabled={!!acting} className="flex-1 py-2 bg-emerald-600 text-white text-[11px] font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40">
                        {acting === review.token + '_redline' ? '...' : '✓ Approve'}
                      </button>
                      <button onClick={() => actRedline(review.token, 'counter', notes[review.id] || '')}
                        disabled={!!acting} className="flex-1 py-2 bg-amber-500 text-white text-[11px] font-bold rounded-xl hover:bg-amber-600 disabled:opacity-40">
                        ↩ Counter
                      </button>
                      <button onClick={() => actRedline(review.token, 'reject', notes[review.id] || '')}
                        disabled={!!acting} className="flex-1 py-2 bg-red-600 text-white text-[11px] font-bold rounded-xl hover:bg-red-700 disabled:opacity-40">
                        ✗ Reject
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
