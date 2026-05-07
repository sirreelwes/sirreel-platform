'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

interface ReviewRow {
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

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function RecentReviewsWidget() {
  const { status: authStatus } = useSession();
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [items, setItems] = useState<ReviewRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    setLoading(true);
    const params = new URLSearchParams({ limit: '10' });
    if (scope === 'mine') params.set('mineOnly', 'true');
    fetch(`/api/tools/contract-review/list?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [scope, authStatus]);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-900">Recent reviews</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-gray-100 border border-gray-200 rounded-lg p-0.5">
            <ScopePill active={scope === 'all'} onClick={() => setScope('all')}>All</ScopePill>
            <ScopePill active={scope === 'mine'} onClick={() => setScope('mine')}>Mine</ScopePill>
          </div>
          <Link
            href="/admin/contract-review/history"
            className="text-[11px] font-semibold text-gray-500 hover:text-gray-900"
          >
            View all →
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-gray-400 py-6 text-center">Loading…</div>
      ) : !items || items.length === 0 ? (
        <div className="text-xs text-gray-400 py-6 text-center">No reviews yet.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {items.map((r) => (
            <Link
              key={r.id}
              href={`/tools/contract-review/${r.id}`}
              className="flex items-center justify-between gap-2 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-gray-900 truncate">
                  {r.company?.name || (
                    <span className="text-gray-400 italic">No company</span>
                  )}
                </div>
                <div className="text-[10px] text-gray-400 truncate">
                  {fmtDate(r.createdAt)} · {r.originalFilename}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {r.aiRiskLevel && (
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      RISK_BADGE[r.aiRiskLevel] || 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {r.aiRiskLevel.toUpperCase()}
                  </span>
                )}
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                    DECISION_BADGE[r.humanDecision] || 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {r.humanDecision}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ScopePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
        active ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'
      }`}
    >
      {children}
    </button>
  );
}
