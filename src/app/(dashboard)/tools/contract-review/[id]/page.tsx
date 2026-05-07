'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ReviewResultPanel } from '@/components/reviews/ReviewResultPanel';

const RISK_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-emerald-100 text-emerald-700',
};

const DECISION_BADGE: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  COUNTERED: 'bg-amber-100 text-amber-700',
  REJECTED: 'bg-red-100 text-red-700',
};

interface ReviewRecord {
  id: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
  aiResponse: any;
  aiRiskLevel: string | null;
  aiRecommendation: string | null;
  humanDecision: string;
  humanDecisionNote: string | null;
  humanDecisionAt: string | null;
  company: { id: string; name: string } | null;
  job: { id: string; jobCode: string; name: string } | null;
  uploadedBy: { id: string; name: string; email: string } | null;
  humanDecisionBy: { id: string; name: string; email: string } | null;
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

export default function ContractReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) || '';

  const [record, setRecord] = useState<ReviewRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);

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
          setRecord(data.review);
          setNote(data.review.humanDecisionNote || '');
        }
      })
      .catch(() => setError('Failed to load review.'))
      .finally(() => setLoading(false));
  }, [id]);

  const recordDecision = async (decision: 'APPROVED' | 'COUNTERED' | 'REJECTED') => {
    if (!record) return;
    setSubmitting(decision);
    try {
      const res = await fetch(`/api/tools/contract-review/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ humanDecision: decision, humanDecisionNote: note || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to record decision');
        return;
      }
      const data = await res.json();
      if (data?.review) {
        setRecord(data.review);
        setNote(data.review.humanDecisionNote || '');
      }
    } finally {
      setSubmitting(null);
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
            <span className={`text-[10px] font-bold px-2 py-1 rounded ${DECISION_BADGE[record.humanDecision] || 'bg-gray-100 text-gray-600'}`}>
              {record.humanDecision}
            </span>
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

      {/* PDF iframe */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 space-y-2">
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

      {/* AI analysis */}
      <ReviewResultPanel review={ai} />

      {/* Human decision */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Human Decision</div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Note for the record (optional)..."
          className="w-full border border-gray-200 rounded-xl p-2.5 text-[12px] resize-none focus:outline-none focus:border-gray-400"
        />
        <div className="flex gap-2">
          <button
            onClick={() => recordDecision('APPROVED')}
            disabled={submitting !== null}
            className="flex-1 py-2 bg-emerald-600 text-white text-[12px] font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting === 'APPROVED' ? 'Saving…' : '✓ Approve'}
          </button>
          <button
            onClick={() => recordDecision('COUNTERED')}
            disabled={submitting !== null}
            className="flex-1 py-2 bg-amber-500 text-white text-[12px] font-bold rounded-xl hover:bg-amber-600 disabled:opacity-50"
          >
            {submitting === 'COUNTERED' ? 'Saving…' : '↩ Counter'}
          </button>
          <button
            onClick={() => recordDecision('REJECTED')}
            disabled={submitting !== null}
            className="flex-1 py-2 bg-red-600 text-white text-[12px] font-bold rounded-xl hover:bg-red-700 disabled:opacity-50"
          >
            {submitting === 'REJECTED' ? 'Saving…' : '✗ Reject'}
          </button>
        </div>
      </div>

      {/* Audit footer */}
      <div className="text-[10px] text-gray-400 space-y-0.5 px-1">
        <div>
          Uploaded {fmtDateTime(record.createdAt)}
          {record.uploadedBy && <> by {record.uploadedBy.name} ({record.uploadedBy.email})</>}
        </div>
        {record.humanDecisionAt && record.humanDecisionBy && (
          <div>
            {record.humanDecision} {fmtDateTime(record.humanDecisionAt)} by {record.humanDecisionBy.name}
          </div>
        )}
      </div>
    </div>
  );
}
