'use client';
import { useState, useCallback } from 'react';

const CHECKS = [
  { key: 'certificateHolder', label: 'Certificate Holder', hard: true },
  { key: 'generalLiability', label: 'General Liability', hard: true },
  { key: 'autoLiability', label: 'Auto Liability', hard: true },
  { key: 'additionalInsured', label: 'Additional Insured', hard: true },
  { key: 'lossPayee', label: 'Loss Payee', hard: true },
  { key: 'primaryNonContributory', label: 'Primary & Non-Contributory', hard: true },
  { key: 'policyExpiry', label: 'Policy Not Expired', hard: true },
  { key: 'umbrella', label: 'Umbrella/Excess', hard: false },
  { key: 'waiverOfSubrogation', label: 'Waiver of Subrogation', hard: false },
  { key: 'entertainmentPackage', label: 'Entertainment Package', hard: false },
  { key: 'workersComp', label: 'Workers Compensation', hard: false },
];

export default function CoiCheckPage() {
  const [file, setFile] = useState<File | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');

  const handleFile = (f: File) => {
    setFile(f);
    setReview(null);
    setError('');
  };

  const runReview = async () => {
    if (!file) return;
    setReviewing(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (companyName) fd.append('companyName', companyName);
      const res = await fetch('/api/tools/coi-check', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.review) setReview(data.review);
      else setError(data.error || 'Review failed');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReviewing(false);
    }
  };

  const reset = () => { setFile(null); setReview(null); setError(''); };

  const getItemPass = (review: any, key: string) => {
    if (key === 'policyExpiry') return !review.policyExpiry?.expired;
    return review[key]?.pass;
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">COI Check</h1>
        <p className="text-sm text-gray-500 mt-0.5">Drop any COI here for instant AI review against SirReel's requirements — no booking needed.</p>
      </div>

      {!review ? (
        <div className="space-y-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => document.getElementById('coi-input')?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              dragOver ? 'border-gray-500 bg-gray-100' :
              file ? 'border-emerald-300 bg-emerald-50' :
              'border-gray-300 hover:border-gray-400 bg-gray-50'
            }`}
          >
            {file ? (
              <div>
                <div className="text-3xl mb-2">📄</div>
                <div className="text-sm font-semibold text-emerald-700">{file.name}</div>
                <div className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(0)} KB · Click to change</div>
              </div>
            ) : (
              <div>
                <div className="text-3xl mb-3">📎</div>
                <div className="text-sm font-semibold text-gray-700">Drop COI here or click to browse</div>
                <div className="text-xs text-gray-400 mt-1">PDF, JPG, or PNG</div>
              </div>
            )}
            <input id="coi-input" type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Production / Company Name (optional)</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400" placeholder="e.g. Warner Bros., Cinepower & Light..." />
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">{error}</div>}

          <button onClick={runReview} disabled={!file || reviewing}
            className="w-full py-3.5 bg-gray-900 text-white rounded-xl font-semibold text-sm hover:bg-gray-800 disabled:opacity-40 transition-colors">
            {reviewing ? '🔍 Reviewing COI...' : 'Review COI →'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Overall status */}
          <div className={`rounded-2xl p-5 flex items-start gap-4 ${
            review.overallPass ? 'bg-emerald-50 border border-emerald-200' :
            review.requiresAdminApproval ? 'bg-amber-50 border border-amber-200' :
            'bg-red-50 border border-red-200'
          }`}>
            <div className="text-3xl">{review.overallPass ? '✅' : review.requiresAdminApproval ? '⚠️' : '❌'}</div>
            <div className="flex-1">
              <div className={`text-base font-bold ${review.overallPass ? 'text-emerald-800' : review.requiresAdminApproval ? 'text-amber-800' : 'text-red-700'}`}>
                {review.overallPass ? 'COI Approved' : review.requiresAdminApproval ? 'Pending Admin Approval' : 'COI Rejected — Hard Fails'}
              </div>
              <div className={`text-sm mt-0.5 ${review.overallPass ? 'text-emerald-600' : review.requiresAdminApproval ? 'text-amber-600' : 'text-red-500'}`}>
                {review.overallPass ? 'All requirements met. This COI is good to go.' :
                 review.requiresAdminApproval ? 'All required coverages pass. Some preferred items need admin sign-off.' :
                 'One or more required coverages are missing or insufficient.'}
              </div>
              {review.insuredName?.found && (
                <div className="text-[11px] text-gray-500 mt-1.5">Insured: <span className="font-semibold">{review.insuredName.found}</span> · Expires: {review.policyExpiry?.date || 'Unknown'}</div>
              )}
            </div>
          </div>

          {/* Hard issues */}
          {review.hardIssues?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider mb-2">Hard Fails — Must Correct</div>
              <ul className="space-y-1">{review.hardIssues.map((issue: string, i: number) => <li key={i} className="text-[12px] text-red-700 flex gap-2"><span>•</span><span>{issue}</span></li>)}</ul>
            </div>
          )}

          {/* Manageable issues */}
          {review.manageableIssues?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-2">Needs Admin Review</div>
              <ul className="space-y-1">{review.manageableIssues.map((issue: string, i: number) => <li key={i} className="text-[12px] text-amber-700 flex gap-2"><span>•</span><span>{issue}</span></li>)}</ul>
            </div>
          )}

          {/* Coverage checklist */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Coverage Breakdown</div>
            </div>
            <div className="divide-y divide-gray-50">
              {CHECKS.map(check => {
                const pass = getItemPass(review, check.key);
                const item = review[check.key];
                return (
                  <div key={check.key} className={`flex items-center gap-3 px-4 py-2.5 ${!pass && !check.hard ? 'bg-amber-50/50' : ''}`}>
                    <span className={`text-sm font-bold flex-shrink-0 ${pass ? 'text-emerald-600' : check.hard ? 'text-red-600' : 'text-amber-500'}`}>
                      {pass ? '✓' : check.hard ? '✗' : '⚠'}
                    </span>
                    <span className="text-[12px] font-medium text-gray-700 flex-1">{check.label}</span>
                    {!check.hard && <span className="text-[9px] text-gray-400 font-semibold">Optional</span>}
                    {item?.found && <span className="text-[10px] text-gray-400 truncate max-w-[120px]">{item.found}</span>}
                    {check.key === 'policyExpiry' && item?.date && <span className="text-[10px] text-gray-400">Exp: {item.date}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {review.notes && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Notes</div>
              <div className="text-[12px] text-gray-600">{review.notes}</div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={reset} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">Check Another COI</button>
            <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(review, null, 2)); }} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">Copy JSON</button>
          </div>
        </div>
      )}
    </div>
  );
}
