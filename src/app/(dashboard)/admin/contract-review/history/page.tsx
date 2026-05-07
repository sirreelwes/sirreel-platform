'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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

interface Row {
  id: string;
  createdAt: string;
  originalFilename: string;
  aiRiskLevel: string | null;
  aiRecommendation: string | null;
  humanDecision: string;
  company: { id: string; name: string } | null;
  job: { id: string; jobCode: string; name: string } | null;
  uploadedBy: { id: string; name: string } | null;
}

const PAGE_SIZE = 25;

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ContractReviewHistoryPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [humanDecision, setHumanDecision] = useState('');
  const [orphansOnly, setOrphansOnly] = useState(false);

  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [orphanCount, setOrphanCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      page: String(page),
    });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (riskLevel) params.set('riskLevel', riskLevel);
    if (recommendation) params.set('recommendation', recommendation);
    if (humanDecision) params.set('humanDecision', humanDecision);
    if (orphansOnly) params.set('orphansOnly', 'true');

    fetch(`/api/tools/contract-review/list?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items || []);
        setTotal(d.total || 0);
        setOrphanCount(d.orphanCount || 0);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [from, to, riskLevel, recommendation, humanDecision, orphansOnly, page]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [from, to, riskLevel, recommendation, humanDecision, orphansOnly]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const clearFilters = () => {
    setFrom('');
    setTo('');
    setRiskLevel('');
    setRecommendation('');
    setHumanDecision('');
    setOrphansOnly(false);
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Contract Review History</h1>
        <p className="text-xs text-gray-500 mt-0.5">Every contract review run, across all jobs and agents.</p>
      </div>

      {orphanCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3">
          <div className="text-[12px] text-amber-800">
            ⚠️ <span className="font-semibold">{orphanCount}</span> {orphanCount === 1 ? 'review is' : 'reviews are'} not linked to a Job.
          </div>
          {!orphansOnly && (
            <button
              onClick={() => setOrphansOnly(true)}
              className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 whitespace-nowrap"
            >
              View orphans →
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-gray-400" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-gray-400" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Risk</label>
            <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-gray-400">
              <option value="">Any</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">AI Rec</label>
            <select value={recommendation} onChange={(e) => setRecommendation(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-gray-400">
              <option value="">Any</option>
              <option value="approve">Approve</option>
              <option value="counter">Counter</option>
              <option value="reject">Reject</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Decision</label>
            <select value={humanDecision} onChange={(e) => setHumanDecision(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-gray-400">
              <option value="">Any</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="COUNTERED">Countered</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={orphansOnly} onChange={(e) => setOrphansOnly(e.target.checked)} className="w-3.5 h-3.5" />
            <span className="text-[11px] text-gray-600">Orphans only (no Job linked)</span>
          </label>
          <button onClick={clearFilters} className="text-[11px] font-semibold text-gray-500 hover:text-gray-900">
            Clear filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Job</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2">AI Rec</th>
              <th className="px-3 py-2">Decision</th>
              <th className="px-3 py-2">Uploaded by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No reviews match these filters.</td></tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                    <Link href={`/tools/contract-review/${r.id}`} className="hover:underline">
                      {fmtDate(r.createdAt)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-900">
                    {r.company ? r.company.name : <span className="text-gray-400 italic">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {r.job ? (
                      <span className="font-mono">[{r.job.jobCode}]</span>
                    ) : (
                      <span className="text-amber-600 italic">orphan</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.aiRiskLevel ? (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${RISK_BADGE[r.aiRiskLevel] || 'bg-gray-100 text-gray-600'}`}>
                        {r.aiRiskLevel.toUpperCase()}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600 capitalize">{r.aiRecommendation || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${DECISION_BADGE[r.humanDecision] || 'bg-gray-100 text-gray-600'}`}>
                      {r.humanDecision}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.uploadedBy?.name || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-[11px] text-gray-500">
          <div>
            Page {page} of {totalPages} · {total} total
          </div>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 border border-gray-200 rounded font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 border border-gray-200 rounded font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
