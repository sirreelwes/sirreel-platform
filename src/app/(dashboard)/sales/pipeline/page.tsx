'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

type JobStatus = 'QUOTED' | 'ACTIVE' | 'WRAPPED' | 'HOLD' | 'CANCELLED';

const COLUMNS: { key: Exclude<JobStatus, 'HOLD' | 'CANCELLED'>; label: string; accent: string }[] = [
  { key: 'QUOTED',  label: 'Quoted',  accent: 'border-purple-800 text-purple-300' },
  { key: 'ACTIVE',  label: 'Active',  accent: 'border-emerald-800 text-emerald-300' },
  { key: 'WRAPPED', label: 'Wrapped', accent: 'border-zinc-700 text-zinc-400' },
];

interface PipelineJob {
  id: string;
  jobCode: string;
  name: string;
  status: JobStatus;
  estimatedValue: number | null;
  orderTotal: number;
  updatedAt: string;
  company: { id: string; name: string };
  agent: { id: string; name: string };
  primaryContact: {
    firstName: string;
    lastName: string;
    role: string;
  } | null;
  _count: { orders: number };
}

function daysSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return '1 day';
  return `${d} days`;
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return null;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function PipelinePage() {
  const { data: session, status: authStatus } = useSession();
  const user = session?.user as any;
  const role: string = user?.role || 'AGENT';
  const userId: string | undefined = user?.id;

  const defaultScope: 'my' | 'team' = role === 'ADMIN' || role === 'MANAGER' ? 'team' : 'my';
  const [scope, setScope] = useState<'my' | 'team'>(defaultScope);
  const [jobs, setJobs] = useState<PipelineJob[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    setScope(role === 'ADMIN' || role === 'MANAGER' ? 'team' : 'my');
  }, [authStatus, role]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !userId) return;
    setLoading(true);
    const params = new URLSearchParams({ statuses: 'QUOTED,ACTIVE,WRAPPED' });
    if (scope === 'my') params.set('agentId', userId);
    fetch(`/api/jobs?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, [scope, userId, authStatus]);

  const byStatus = useMemo(() => {
    const groups: Record<string, PipelineJob[]> = { QUOTED: [], ACTIVE: [], WRAPPED: [] };
    (jobs || []).forEach((j) => {
      if (groups[j.status]) groups[j.status].push(j);
    });
    return groups;
  }, [jobs]);

  const totals = useMemo(() => {
    const out: Record<string, number> = { QUOTED: 0, ACTIVE: 0, WRAPPED: 0 };
    Object.entries(byStatus).forEach(([k, list]) => {
      out[k] = list.reduce((sum, j) => sum + (j.orderTotal > 0 ? j.orderTotal : j.estimatedValue || 0), 0);
    });
    return out;
  }, [byStatus]);

  if (authStatus === 'loading') {
    return <div className="min-h-[60vh] flex items-center justify-center text-zinc-500 text-sm">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Sales Pipeline</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Deals in flight. Kanban is read-only — click a card to open the job.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          <ScopeButton active={scope === 'my'} onClick={() => setScope('my')}>My Deals</ScopeButton>
          <ScopeButton active={scope === 'team'} onClick={() => setScope('team')}>Team View</ScopeButton>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map((col) => {
          const list = byStatus[col.key] || [];
          return (
            <div
              key={col.key}
              className={`bg-zinc-900 border border-zinc-800 rounded-xl p-3 border-t-2 ${col.accent}`}
            >
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${col.accent.split(' ')[1]}`}>
                    {col.label}
                  </span>
                  <span className="text-[10px] text-zinc-500">{list.length}</span>
                </div>
                <span className="text-[11px] font-mono text-zinc-400">
                  {fmtMoney(totals[col.key]) || '—'}
                </span>
              </div>

              <div className="space-y-2 min-h-[120px]">
                {loading ? (
                  <div className="text-xs text-zinc-600 text-center py-6">Loading…</div>
                ) : list.length === 0 ? (
                  <div className="text-xs text-zinc-600 text-center py-6">No deals</div>
                ) : (
                  list.map((j) => <DealCard key={j.id} job={j} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScopeButton({
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
      className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
        active ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function DealCard({ job }: { job: PipelineJob }) {
  const deal =
    job.orderTotal > 0
      ? fmtMoney(job.orderTotal)
      : job.estimatedValue != null
      ? `Est. ${fmtMoney(job.estimatedValue)}`
      : '—';

  const contact = job.primaryContact
    ? `${job.primaryContact.firstName} ${job.primaryContact.lastName}`
    : null;

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="block bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{job.name}</div>
          <div className="text-xs text-zinc-400 truncate">{job.company.name}</div>
        </div>
        <span className="text-[9px] font-mono text-zinc-600 flex-shrink-0">{job.jobCode}</span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-amber-400">{deal}</span>
        <span className="text-[10px] text-zinc-500">{daysSince(job.updatedAt)} in stage</span>
      </div>

      {contact && (
        <div className="mt-1.5 text-[11px] text-zinc-500 truncate">
          {contact}
          {job.primaryContact?.role && (
            <span className="text-zinc-600"> · {job.primaryContact.role}</span>
          )}
        </div>
      )}
    </Link>
  );
}
