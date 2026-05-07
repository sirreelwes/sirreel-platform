'use client';
import { useEffect, useState } from 'react';
import { CompanyPicker } from '@/components/orders/CompanyPicker';
import { JobPicker } from '@/components/orders/JobPicker';
import { NewJobModal } from '@/components/orders/NewJobModal';
import { ReviewResultPanel } from '@/components/reviews/ReviewResultPanel';
import { RecentReviewsWidget } from '@/components/reviews/RecentReviewsWidget';

export default function ContractReviewPage() {
  const [file, setFile] = useState<File | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [showJobConfirmModal, setShowJobConfirmModal] = useState(false);
  const [showNewJobModal, setShowNewJobModal] = useState(false);
  const [jobsRefreshKey, setJobsRefreshKey] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  // Reset job when company changes — previously selected job no longer applies
  useEffect(() => { setJobId(null); }, [companyId]);

  const handleFile = (f: File) => { setFile(f); setReview(null); setError(''); };

  const runReview = async () => {
    if (!file) return;
    setReviewing(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (companyName) fd.append('companyName', companyName);
      if (companyId) fd.append('companyId', companyId);
      if (jobId) fd.append('jobId', jobId);
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

  const handleSubmit = () => {
    if (!file) return;
    if (!jobId) {
      setShowJobConfirmModal(true);
      return;
    }
    runReview();
  };

  const continueWithoutJob = () => {
    setShowJobConfirmModal(false);
    runReview();
  };

  const reset = () => {
    setFile(null);
    setReview(null);
    setError('');
    setNote('');
    setSent(false);
    setCompanyId('');
    setCompanyName('');
    setJobId(null);
  };

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

          <div className="bg-zinc-900 rounded-2xl p-4 space-y-3">
            <p className="text-[11px] text-zinc-500">
              Optional but strongly suggested — link this review to a Company and Job so you can find it later.
            </p>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Company</label>
              <CompanyPicker
                value={companyId || null}
                selectedName={companyName || null}
                onChange={(id, name) => {
                  setCompanyId(id);
                  setCompanyName(name);
                }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Job</label>
              <JobPicker
                companyId={companyId || null}
                value={jobId}
                onChange={setJobId}
                onCreateNew={() => setShowNewJobModal(true)}
                refreshKey={jobsRefreshKey}
              />
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">{error}</div>}

          <button onClick={handleSubmit} disabled={!file || reviewing}
            className="w-full py-3.5 bg-gray-900 text-white rounded-xl font-semibold text-sm hover:bg-gray-800 disabled:opacity-40 transition-colors">
            {reviewing ? '📋 Reviewing changes...' : 'Review Contract →'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <ReviewResultPanel review={review} />

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

      <RecentReviewsWidget />

      {showJobConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900">No Job linked</h2>
            <p className="text-sm text-gray-600">
              Contracts are usually associated with a Job. Skipping this means the review will be saved as an orphan and you&apos;ll need to link it later.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowJobConfirmModal(false)}
                className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Pick a Job
              </button>
              <button
                onClick={continueWithoutJob}
                className="flex-1 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800"
              >
                Continue without Job
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewJobModal && companyId && (
        <NewJobModal
          open={showNewJobModal}
          onClose={() => setShowNewJobModal(false)}
          companyId={companyId}
          companyName={companyName}
          onCreated={(job) => {
            setJobId(job.id);
            setJobsRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
