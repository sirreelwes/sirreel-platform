'use client';
import { useState } from 'react';

const TYPE_CONFIG = {
  auto_approved: { color: 'bg-emerald-50 border-emerald-200 text-emerald-800', icon: '✓', badge: 'bg-emerald-100 text-emerald-700', label: 'Auto-approved' },
  needs_review: { color: 'bg-amber-50 border-amber-200 text-amber-800', icon: '⚠', badge: 'bg-amber-100 text-amber-700', label: 'Needs review' },
  not_acceptable: { color: 'bg-red-50 border-red-200 text-red-700', icon: '✗', badge: 'bg-red-100 text-red-700', label: 'Not acceptable' },
};

export default function ContractReviewPage() {
  const [file, setFile] = useState<File | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  const handleFile = (f: File) => { setFile(f); setReview(null); setError(''); };

  const runReview = async () => {
    if (!file) return;
    setReviewing(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (companyName) fd.append('companyName', companyName);
      const res = await fetch('/api/tools/contract-review', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.review) setReview(data.review);
      else setError(data.error || 'Review failed');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReviewing(false);
    }
  };

  const reset = () => { setFile(null); setReview(null); setError(''); setNote(''); setSent(false); };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Contract Redline Review</h1>
        <p className="text-sm text-gray-500 mt-0.5">Drop a client's redlined rental agreement for instant AI review of every proposed change.</p>
      </div>

      {!review ? (
        <div className="space-y-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => document.getElementById('contract-input')?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              dragOver ? 'border-gray-500 bg-gray-100' :
              file ? 'border-blue-300 bg-blue-50' :
              'border-gray-300 hover:border-gray-400 bg-gray-50'
            }`}
          >
            {file ? (
              <div>
                <div className="text-3xl mb-2">📝</div>
                <div className="text-sm font-semibold text-blue-700">{file.name}</div>
                <div className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(0)} KB · Click to change</div>
              </div>
            ) : (
              <div>
                <div className="text-3xl mb-3">📝</div>
                <div className="text-sm font-semibold text-gray-700">Drop redlined contract here or click to browse</div>
                <div className="text-xs text-gray-400 mt-1">PDF or Word (.docx)</div>
              </div>
            )}
            <input id="contract-input" type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Production / Company Name (optional)</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400" placeholder="e.g. Warner Bros., Cinepower & Light..." />
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">{error}</div>}

          <button onClick={runReview} disabled={!file || reviewing}
            className="w-full py-3.5 bg-gray-900 text-white rounded-xl font-semibold text-sm hover:bg-gray-800 disabled:opacity-40 transition-colors">
            {reviewing ? '📋 Reviewing changes...' : 'Review Contract →'}
          </button>
        </div>
      ) : (
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

          {/* Action section */}
          {!sent ? (
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Send Response</div>
              <textarea value={note} onChange={e => setNote(e.target.value)}
                className="w-full border border-gray-200 rounded-xl p-2.5 text-[12px] resize-none focus:outline-none focus:border-gray-400"
                rows={2} placeholder="Note for the client (optional)..." />
              <div className="flex gap-2">
                <button onClick={() => setSent(true)} className="flex-1 py-2 bg-emerald-600 text-white text-[12px] font-bold rounded-xl hover:bg-emerald-700">✓ Approve</button>
                <button onClick={() => setSent(true)} className="flex-1 py-2 bg-amber-500 text-white text-[12px] font-bold rounded-xl hover:bg-amber-600">↩ Counter</button>
                <button onClick={() => setSent(true)} className="flex-1 py-2 bg-red-600 text-white text-[12px] font-bold rounded-xl hover:bg-red-700">✗ Reject</button>
              </div>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center text-sm text-emerald-700 font-semibold">✓ Response recorded</div>
          )}

          <button onClick={reset} className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">Review Another Document</button>
        </div>
      )}
    </div>
  );
}
