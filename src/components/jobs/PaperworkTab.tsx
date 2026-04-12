'use client';
import { useState } from 'react';

type ReviewState = {
  file: File | null;
  reviewing: boolean;
  review: any;
  error: string;
};

const initState = (): ReviewState => ({ file: null, reviewing: false, review: null, error: '' });

function DropZone({
  label, sublabel, accept, docType, state, onFile
}: {
  label: string;
  sublabel: string;
  accept: string;
  docType: string;
  state: ReviewState;
  onFile: (f: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  if (state.reviewing) return (
    <div className="border-2 border-dashed border-blue-300 bg-blue-50 rounded-xl p-6 text-center">
      <div className="text-2xl mb-2">🔍</div>
      <div className="text-sm font-semibold text-blue-700">Reviewing {state.file?.name}...</div>
      <div className="text-xs text-blue-500 mt-1">AI is analyzing the document</div>
    </div>
  );

  if (state.review) return null; // Show results instead

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onClick={() => document.getElementById(`drop-${docType}`)?.click()}
      className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
        dragOver ? 'border-gray-500 bg-gray-100' : 'border-gray-200 hover:border-gray-300 bg-gray-50'
      }`}
    >
      <div className="text-xl mb-1">📎</div>
      <div className="text-[12px] font-semibold text-gray-700">{label}</div>
      <div className="text-[10px] text-gray-400 mt-0.5">{sublabel}</div>
      <input id={`drop-${docType}`} type="file" accept={accept} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </div>
  );
}

function CoiResults({ review, token, onReset, onApprove }: { review: any; token?: string; onReset: () => void; onApprove?: (note: string) => void }) {
  const [approvalNote, setApprovalNote] = useState('');
  const [approved, setApproved] = useState(false);

  const checks = [
    { key: 'certificateHolder', label: 'Certificate Holder', hard: true },
    { key: 'generalLiability', label: 'General Liability', hard: true },
    { key: 'autoLiability', label: 'Auto Liability', hard: true },
    { key: 'additionalInsured', label: 'Additional Insured', hard: true },
    { key: 'lossPayee', label: 'Loss Payee', hard: true },
    { key: 'primaryNonContributory', label: 'Primary & Non-Contributory', hard: true },
    { key: 'umbrella', label: 'Umbrella/Excess', hard: false },
    { key: 'waiverOfSubrogation', label: 'Waiver of Subrogation', hard: false },
    { key: 'entertainmentPackage', label: 'Entertainment Package', hard: false },
    { key: 'workersComp', label: 'Workers Comp', hard: false },
  ];

  const getPass = (key: string) => key === 'policyExpiry' ? !review.policyExpiry?.expired : review[key]?.pass;

  return (
    <div className="space-y-3">
      <div className={`rounded-xl p-3 flex items-center gap-3 ${
        review.overallPass ? 'bg-emerald-50 border border-emerald-200' :
        review.requiresAdminApproval ? 'bg-amber-50 border border-amber-200' :
        'bg-red-50 border border-red-200'
      }`}>
        <span className="text-xl">{review.overallPass ? '✅' : review.requiresAdminApproval ? '⚠️' : '❌'}</span>
        <div className="flex-1">
          <div className={`text-sm font-bold ${review.overallPass ? 'text-emerald-800' : review.requiresAdminApproval ? 'text-amber-800' : 'text-red-700'}`}>
            {review.overallPass ? 'COI Approved' : review.requiresAdminApproval ? 'Pending Admin Approval' : 'COI Rejected'}
          </div>
          <div className={`text-[11px] mt-0.5 ${review.overallPass ? 'text-emerald-600' : review.requiresAdminApproval ? 'text-amber-600' : 'text-red-500'}`}>
            {review.insuredName?.found && `Insured: ${review.insuredName.found} · `}{review.policyExpiry?.date && `Expires: ${review.policyExpiry.date}`}
          </div>
        </div>
        <button onClick={onReset} className="text-[10px] text-gray-400 hover:text-gray-600 flex-shrink-0">Replace ↑</button>
      </div>

      {review.hardIssues?.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3">
          <div className="text-[9px] font-bold text-red-600 uppercase mb-1.5">Must Correct</div>
          <ul className="space-y-0.5">{review.hardIssues.map((i: string, idx: number) => <li key={idx} className="text-[11px] text-red-600">• {i}</li>)}</ul>
        </div>
      )}

      {review.manageableIssues?.length > 0 && review.requiresAdminApproval && !approved && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-2">
          <div className="text-[9px] font-bold text-amber-600 uppercase">Manageable Issues — Admin Approval</div>
          <ul className="space-y-0.5">{review.manageableIssues.map((i: string, idx: number) => <li key={idx} className="text-[11px] text-amber-700">• {i}</li>)}</ul>
          <input value={approvalNote} onChange={e => setApprovalNote(e.target.value)}
            className="w-full border border-amber-200 rounded-lg px-2.5 py-1.5 text-[11px] bg-white focus:outline-none focus:border-amber-400"
            placeholder="Note explaining approval (e.g. short shoot, GL sufficient)..." />
          <button onClick={() => { onApprove?.(approvalNote); setApproved(true); }}
            className="w-full py-1.5 bg-amber-500 text-white text-[11px] font-bold rounded-lg hover:bg-amber-600">
            ✓ Approve COI with Exceptions
          </button>
        </div>
      )}

      {approved && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 text-center text-[12px] text-emerald-700 font-semibold">✓ COI approved with exceptions</div>
      )}

      <div className="space-y-1">
        {checks.filter(c => review[c.key]).map(c => {
          const pass = getPass(c.key);
          return (
            <div key={c.key} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] ${pass ? 'bg-emerald-50 text-emerald-700' : c.hard ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
              <span className="font-bold">{pass ? '✓' : c.hard ? '✗' : '⚠'}</span>
              <span className="flex-1">{c.label}</span>
              {!c.hard && !pass && <span className="text-[8px] bg-amber-100 px-1.5 py-0.5 rounded font-bold">Admin</span>}
              {review[c.key]?.found && <span className="text-gray-400 text-[10px] truncate max-w-[80px]">{review[c.key].found}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RedlineResults({ review, onReset }: { review: any; onReset: () => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  const TYPE_CFG = {
    auto_approved: { bg: 'bg-emerald-50 border-emerald-100', icon: '✓', badge: 'bg-emerald-100 text-emerald-700' },
    needs_review: { bg: 'bg-amber-50 border-amber-100', icon: '⚠', badge: 'bg-amber-100 text-amber-700' },
    not_acceptable: { bg: 'bg-red-50 border-red-100', icon: '✗', badge: 'bg-red-100 text-red-700' },
  };

  return (
    <div className="space-y-3">
      <div className={`rounded-xl p-3 flex items-start gap-3 ${review.recommendation === 'approve' ? 'bg-emerald-50 border border-emerald-200' : review.recommendation === 'reject' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
        <span className="text-xl">{review.recommendation === 'approve' ? '✅' : review.recommendation === 'reject' ? '❌' : '📋'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-900">AI: {review.recommendation === 'approve' ? 'Approve' : review.recommendation === 'reject' ? 'Reject' : 'Counter-propose'}</div>
          <div className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{review.summary}</div>
          <div className="flex gap-2 mt-1.5 text-[10px]">
            <span className="text-emerald-600 font-semibold">✓ {review.autoApprovedCount}</span>
            <span className="text-amber-600 font-semibold">⚠ {review.needsReviewCount}</span>
            <span className="text-red-600 font-semibold">✗ {review.notAcceptableCount}</span>
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${review.riskLevel === 'high' ? 'bg-red-100 text-red-700' : review.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{review.riskLevel?.toUpperCase()}</span>
          <button onClick={onReset} className="text-[10px] text-gray-400 hover:text-gray-600">Replace ↑</button>
        </div>
      </div>

      <div className="space-y-1.5">
        {review.changes?.map((change: any, i: number) => {
          const cfg = TYPE_CFG[change.type as keyof typeof TYPE_CFG] || TYPE_CFG.needs_review;
          return (
            <div key={i} className={`rounded-xl border p-2.5 ${cfg.bg}`}>
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(expanded === i ? null : i)}>
                <span className="text-sm font-bold">{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold flex items-center gap-1.5">
                    {change.clause && <span className="opacity-40">§{change.clause}</span>}
                    <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${cfg.badge}`}>{change.type === 'auto_approved' ? 'Auto-ok' : change.type === 'needs_review' ? 'Review' : 'Reject'}</span>
                  </div>
                  <div className="text-[10px] opacity-60 truncate">{change.proposed}</div>
                </div>
                <span className="text-[9px] opacity-30">{expanded === i ? '▲' : '▼'}</span>
              </div>
              {expanded === i && (
                <div className="mt-2 pt-2 border-t border-current border-opacity-10 space-y-1.5 text-[11px]">
                  <div><span className="font-bold opacity-50">Original: </span>{change.original}</div>
                  <div><span className="font-bold opacity-50">Proposed: </span>{change.proposed}</div>
                  <div><span className="font-bold opacity-50">Why: </span><span className="opacity-70">{change.reasoning}</span></div>
                  {change.suggestedCounter && <div className="bg-white/50 rounded px-2 py-1"><span className="font-bold opacity-50">Counter: </span>{change.suggestedCounter}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!sent ? (
        <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
          <textarea value={note} onChange={e => setNote(e.target.value)}
            className="w-full border border-gray-100 rounded-lg p-2 text-[11px] resize-none focus:outline-none bg-gray-50"
            rows={2} placeholder="Note for client response (optional)..." />
          <div className="flex gap-1.5">
            <button onClick={() => setSent(true)} className="flex-1 py-1.5 bg-emerald-600 text-white text-[11px] font-bold rounded-lg hover:bg-emerald-700">✓ Approve</button>
            <button onClick={() => setSent(true)} className="flex-1 py-1.5 bg-amber-500 text-white text-[11px] font-bold rounded-lg hover:bg-amber-600">↩ Counter</button>
            <button onClick={() => setSent(true)} className="flex-1 py-1.5 bg-red-600 text-white text-[11px] font-bold rounded-lg hover:bg-red-700">✗ Reject</button>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 text-center text-[12px] text-emerald-700 font-semibold">✓ Response recorded</div>
      )}
    </div>
  );
}

export default function PaperworkTab({ booking, token }: { booking: any; token?: string }) {
  const [coiState, setCoiState] = useState<ReviewState>(initState());
  const [wcState, setWcState] = useState<ReviewState>(initState());
  const [redlineState, setRedlineState] = useState<ReviewState>(initState());

  const companyName = booking?.company?.name || '';

  const handleCoi = async (file: File) => {
    setCoiState(s => ({ ...s, file, reviewing: true, error: '' }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('companyName', companyName);
      // Use token-based endpoint if we have a token, else use standalone
      const url = token ? `/api/portal/${token}/coi-review` : '/api/tools/coi-check';
      const res = await fetch(url, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.review) setCoiState(s => ({ ...s, reviewing: false, review: data.review }));
      else setCoiState(s => ({ ...s, reviewing: false, error: data.error || 'Review failed' }));
    } catch (err: any) {
      setCoiState(s => ({ ...s, reviewing: false, error: err.message }));
    }
  };

  const handleWc = async (file: File) => {
    setWcState(s => ({ ...s, file, reviewing: true, error: '' }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('companyName', companyName);
      const url = token ? `/api/portal/${token}/wc-review` : '/api/tools/coi-check';
      const res = await fetch(url, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.review) setWcState(s => ({ ...s, reviewing: false, review: data.review }));
      else setWcState(s => ({ ...s, reviewing: false, error: data.error || 'Review failed' }));
    } catch (err: any) {
      setWcState(s => ({ ...s, reviewing: false, error: err.message }));
    }
  };

  const handleRedline = async (file: File) => {
    setRedlineState(s => ({ ...s, file, reviewing: true, error: '' }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('companyName', companyName);
      const url = token ? `/api/portal/${token}/contract/redline` : '/api/tools/contract-review';
      const res = await fetch(url, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.review) setRedlineState(s => ({ ...s, reviewing: false, review: data.review }));
      else setRedlineState(s => ({ ...s, reviewing: false, error: data.error || 'Review failed' }));
    } catch (err: any) {
      setRedlineState(s => ({ ...s, reviewing: false, error: err.message }));
    }
  };

  const handleCoiApprove = async (note: string) => {
    if (!token) return;
    await fetch(`/api/portal/${token}/coi-approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'Admin', note })
    });
  };

  return (
    <div className="space-y-5 p-4">

      {/* Paperwork status overview */}
      {booking && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Agreement', done: booking.rentalAgreement },
            { label: 'LCDW', done: booking.lcdwAccepted },
            { label: 'COI', done: booking.coiReceived },
            { label: 'CC Auth', done: booking.creditCardAuth },
          ].map(item => (
            <div key={item.label} className={`rounded-xl p-3 text-center border ${item.done ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50/50 border-red-100'}`}>
              <div className="text-lg">{item.done ? '✅' : '⏳'}</div>
              <div className={`text-[11px] font-semibold mt-1 ${item.done ? 'text-emerald-700' : 'text-red-600'}`}>{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Portal link */}
      {token && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold text-blue-600 uppercase">Client Portal</div>
            <div className="text-[11px] text-blue-700 font-mono truncate">{`https://hq.sirreel.com/portal/${token}`}</div>
          </div>
          <button onClick={() => navigator.clipboard.writeText(`https://hq.sirreel.com/portal/${token}`)}
            className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-semibold rounded-lg hover:bg-blue-700 flex-shrink-0">
            Copy Link
          </button>
        </div>
      )}

      {/* COI Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">Certificate of Insurance</div>
          {coiState.review && <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${coiState.review.overallPass ? 'bg-emerald-100 text-emerald-700' : coiState.review.requiresAdminApproval ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>{coiState.review.overallPass ? 'Approved' : coiState.review.requiresAdminApproval ? 'Pending Approval' : 'Rejected'}</div>}
        </div>
        <DropZone label="Drop COI here" sublabel="Drag from email or desktop · PDF, JPG, PNG" accept=".pdf,.jpg,.jpeg,.png" docType="coi" state={coiState} onFile={handleCoi} />
        {coiState.error && <div className="mt-2 text-[11px] text-red-600 bg-red-50 rounded-lg p-2">{coiState.error}</div>}
        {coiState.review && <div className="mt-2"><CoiResults review={coiState.review} token={token} onReset={() => setCoiState(initState())} onApprove={handleCoiApprove} /></div>}
      </div>

      {/* WC Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">Workers Compensation</div>
          {wcState.review && <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${wcState.review.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>{wcState.review.pass ? 'Approved' : 'Issues'}</div>}
        </div>
        <DropZone label="Drop WC Certificate here" sublabel="Separate WC cert from payroll company · PDF, JPG, PNG" accept=".pdf,.jpg,.jpeg,.png" docType="wc" state={wcState} onFile={handleWc} />
        {wcState.error && <div className="mt-2 text-[11px] text-red-600 bg-red-50 rounded-lg p-2">{wcState.error}</div>}
        {wcState.review && (
          <div className="mt-2 space-y-2">
            <div className={`rounded-xl p-3 flex items-center gap-3 ${wcState.review.pass ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
              <span>{wcState.review.pass ? '✅' : '❌'}</span>
              <div>
                <div className={`text-sm font-bold ${wcState.review.pass ? 'text-emerald-800' : 'text-red-700'}`}>{wcState.review.pass ? 'Workers Comp Approved' : 'Needs Correction'}</div>
                {wcState.review.provider && <div className="text-[11px] text-gray-500">Provider: {wcState.review.provider}{wcState.review.expiryDate && ` · Expires ${wcState.review.expiryDate}`}</div>}
              </div>
              <button onClick={() => setWcState(initState())} className="text-[10px] text-gray-400 ml-auto">Replace ↑</button>
            </div>
          </div>
        )}
      </div>

      {/* Contract Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">Contract</div>
          {redlineState.review && <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${redlineState.review.recommendation === 'approve' ? 'bg-emerald-100 text-emerald-700' : redlineState.review.recommendation === 'reject' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>{redlineState.review.riskLevel?.toUpperCase()} RISK</div>}
        </div>
        <DropZone label="Drop contract here" sublabel="Signed contract or redlined version · PDF or Word" accept=".pdf,.doc,.docx" docType="redline" state={redlineState} onFile={handleRedline} />
        {redlineState.error && <div className="mt-2 text-[11px] text-red-600 bg-red-50 rounded-lg p-2">{redlineState.error}</div>}
        {redlineState.review && <div className="mt-2"><RedlineResults review={redlineState.review} onReset={() => setRedlineState(initState())} /></div>}
      </div>

    </div>
  );
}
