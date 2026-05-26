'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DEPARTMENT_SHORT, type PipelineColumn } from '@/lib/sales/pipeline';
import type { LineItemDepartment } from '@prisma/client';
import { MarkLostModal } from './MarkLostModal';

interface QuoteJob {
  id: string;
  jobCode: string;
  name: string;
  estimatedValue: number | null;
  orderTotal: number;
  updatedAt: string;
  company: { id: string; name: string };
  agent: { id: string; name: string };
  pipelineColumn: PipelineColumn | null;
  quoteBreakdown?: {
    quotes: number;
    won: number;
    pending: number;
    lost: number;
    expired: number;
  };
  departments?: LineItemDepartment[];
}

interface OpenQuotesKanbanProps {
  jobs: QuoteJob[];
  loading: boolean;
  onChange?: () => void;
}

const COLUMNS: { key: PipelineColumn; label: string; accent: string }[] = [
  { key: 'DRAFT', label: 'Draft',  accent: 'border-zinc-700 text-zinc-300' },
  { key: 'SENT',  label: 'Sent',   accent: 'border-blue-800 text-blue-300' },
  { key: 'WON',   label: 'Won',    accent: 'border-emerald-800 text-emerald-300' },
  { key: 'LOST',  label: 'Lost',   accent: 'border-red-900 text-red-300' },
];

const MAX_VISIBLE_DEPTS = 4;

function fmtMoney(n: number | null | undefined) {
  if (n == null) return null;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function daysSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return '1 day';
  return `${d} days`;
}

export function OpenQuotesKanban({ jobs, loading, onChange }: OpenQuotesKanbanProps) {
  const [nudgingJobId, setNudgingJobId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [lost, setLost] = useState<QuoteJob | null>(null);

  // Repointed to the branded Resend endpoint via the job-scoped wrapper,
  // which resolves the Job's latest SENT order and forwards to the
  // per-order endpoint. Server picks the STAGE_N (currentDueStage or
  // first unsent) — Kanban doesn't track cadence per Job.
  const nudgeJob = async (job: QuoteJob) => {
    setNudgingJobId(job.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/follow-ups/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        setFeedback({ kind: 'err', text: json?.error || 'Send failed' });
      } else {
        setFeedback({
          kind: 'ok',
          text: `Follow-up sent for ${job.jobCode} to ${json?.recipient?.email ?? 'client'}`,
        });
        onChange?.();
      }
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Send failed' });
    } finally {
      setNudgingJobId(null);
    }
  };

  const byColumn: Record<PipelineColumn, QuoteJob[]> = {
    DRAFT: [],
    SENT: [],
    WON: [],
    LOST: [],
  };
  for (const j of jobs) {
    if (j.pipelineColumn) byColumn[j.pipelineColumn].push(j);
  }

  const totals: Record<PipelineColumn, number> = {
    DRAFT: 0,
    SENT: 0,
    WON: 0,
    LOST: 0,
  };
  for (const col of COLUMNS) {
    totals[col.key] = byColumn[col.key].reduce(
      (sum, j) => sum + (j.orderTotal > 0 ? j.orderTotal : j.estimatedValue || 0),
      0
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-gray-900">Open Quotes</h2>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Job-level view of every active quote. Cards are placed by the earliest unfinished order.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {COLUMNS.map((col) => {
          const list = byColumn[col.key];
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
                  list.map((j) => (
                    <QuoteCard
                      key={j.id}
                      job={j}
                      nudging={nudgingJobId === j.id}
                      nudgeDisabled={nudgingJobId !== null}
                      onNudge={col.key === 'SENT' ? () => { void nudgeJob(j); } : undefined}
                      onMarkLost={col.key === 'DRAFT' || col.key === 'SENT' ? () => setLost(j) : undefined}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {feedback && (
        <div
          className={`text-[11px] px-3 py-2 rounded ${
            feedback.kind === 'ok'
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              : 'bg-red-100 text-red-800 border border-red-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <MarkLostModal
        job={lost ? { id: lost.id, name: lost.name, jobCode: lost.jobCode, company: lost.company } : null}
        onClose={() => setLost(null)}
        onMarked={() => { setLost(null); onChange?.(); }}
      />
    </section>
  );
}

function QuoteCard({
  job,
  onNudge,
  onMarkLost,
  nudging = false,
  nudgeDisabled = false,
}: {
  job: QuoteJob;
  onNudge?: () => void;
  onMarkLost?: () => void;
  nudging?: boolean;
  nudgeDisabled?: boolean;
}) {
  const deal =
    job.orderTotal > 0
      ? fmtMoney(job.orderTotal)
      : job.estimatedValue != null
      ? `Est. ${fmtMoney(job.estimatedValue)}`
      : '—';

  const breakdown = job.quoteBreakdown;
  const departments = job.departments || [];
  const visibleDepts = departments.slice(0, MAX_VISIBLE_DEPTS);
  const overflow = Math.max(0, departments.length - MAX_VISIBLE_DEPTS);

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

      {breakdown && breakdown.quotes > 0 && (
        <div className="mt-1.5 text-[10px] text-zinc-500">
          {breakdown.quotes} quote{breakdown.quotes === 1 ? '' : 's'}
          {breakdown.won > 0 && <> · {breakdown.won} won</>}
          {breakdown.pending > 0 && <> · {breakdown.pending} pending</>}
          {breakdown.lost > 0 && <> · {breakdown.lost} lost</>}
        </div>
      )}

      {visibleDepts.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          {visibleDepts.map((d) => (
            <span
              key={d}
              className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700"
            >
              {DEPARTMENT_SHORT[d]}
            </span>
          ))}
          {overflow > 0 && (
            <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-zinc-500">
              +{overflow}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-amber-400">{deal}</span>
        <span className="text-[10px] text-zinc-500">{daysSince(job.updatedAt)} in stage</span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-zinc-500 truncate">{job.agent.name}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onNudge && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onNudge(); }}
              disabled={nudgeDisabled}
              title={nudging ? 'Sending…' : 'Send branded follow-up email'}
              className="text-[10px] font-semibold text-blue-300 hover:text-blue-200 disabled:opacity-50 disabled:cursor-not-allowed px-1.5 py-0.5 rounded hover:bg-blue-900/30 transition-colors"
            >
              {nudging ? 'Sending…' : 'Nudge'}
            </button>
          )}
          {onMarkLost && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMarkLost(); }}
              className="text-[10px] font-semibold text-red-300 hover:text-red-200 px-1.5 py-0.5 rounded hover:bg-red-900/30 transition-colors"
            >
              Lost
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
