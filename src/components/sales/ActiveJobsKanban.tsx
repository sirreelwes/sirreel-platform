'use client';

import Link from 'next/link';

interface ActiveJob {
  id: string;
  jobCode: string;
  name: string;
  status: 'ACTIVE' | 'WRAPPED' | string;
  startDate: string | null;
  endDate: string | null;
  estimatedValue: number | null;
  orderTotal: number;
  company: { id: string; name: string };
  agent: { id: string; name: string };
}

interface ActiveJobsKanbanProps {
  jobs: ActiveJob[];
  loading: boolean;
}

const COLUMNS: { key: 'ACTIVE' | 'WRAPPED'; label: string; accent: string }[] = [
  { key: 'ACTIVE',  label: 'Active',  accent: 'border-emerald-800 text-emerald-300' },
  { key: 'WRAPPED', label: 'Wrapped', accent: 'border-zinc-700 text-zinc-400' },
];

function fmtMoney(n: number | null | undefined) {
  if (n == null) return null;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtRange(start: string | null, end: string | null) {
  if (!start && !end) return '—';
  const s = start ? new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
  const e = end ? new Date(end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
  return `${s} → ${e}`;
}

export function ActiveJobsKanban({ jobs, loading }: ActiveJobsKanbanProps) {
  const byStatus: Record<'ACTIVE' | 'WRAPPED', ActiveJob[]> = { ACTIVE: [], WRAPPED: [] };
  for (const j of jobs) {
    if (j.status === 'ACTIVE') byStatus.ACTIVE.push(j);
    else if (j.status === 'WRAPPED') byStatus.WRAPPED.push(j);
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-gray-900">Active Jobs</h2>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Production-stage jobs — already on rental or wrapping up.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {COLUMNS.map((col) => {
          const list = byStatus[col.key];
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
              </div>
              <div className="space-y-2 min-h-[80px]">
                {loading ? (
                  <div className="text-xs text-zinc-600 text-center py-6">Loading…</div>
                ) : list.length === 0 ? (
                  <div className="text-xs text-zinc-600 text-center py-6">No jobs</div>
                ) : (
                  list.map((j) => <ActiveCard key={j.id} job={j} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActiveCard({ job }: { job: ActiveJob }) {
  const deal =
    job.orderTotal > 0
      ? fmtMoney(job.orderTotal)
      : job.estimatedValue != null
      ? `Est. ${fmtMoney(job.estimatedValue)}`
      : '—';

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
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-zinc-400">{fmtRange(job.startDate, job.endDate)}</span>
        <span className="font-mono text-amber-400">{deal}</span>
      </div>
      <div className="mt-1 text-[11px] text-zinc-500 truncate">{job.agent.name}</div>
    </Link>
  );
}
