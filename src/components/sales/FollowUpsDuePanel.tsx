'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmailReviewModal, type EmailReviewTarget } from '@/components/email/EmailReviewModal';
import { shouldReview } from '@/lib/email/reviewGate';

type Scope = 'my' | 'team';

type Stage = 'DAY_0' | 'DAY_1' | 'DAY_3';

interface FollowUp {
  id: string;
  stage: Stage;
  dueAt: string;
  draftSubject: string;
  draftBody: string;
  order: {
    id: string;
    orderNumber: string;
    total: number;
    sentAt: string | null;
    company: { id: string; name: string };
    agent: { id: string; name: string };
    job: { id: string; jobCode: string; name: string };
    jobContact: { id: string; firstName: string; lastName: string; email: string } | null;
  };
}

const STAGE_LABEL: Record<Stage, string> = {
  DAY_0: 'Same-day check-in',
  DAY_1: 'Day-1 follow-up',
  DAY_3: 'Day-3 follow-up',
};

const STAGE_TONE: Record<Stage, string> = {
  DAY_0: 'bg-blue-900/40 text-blue-200 border-blue-800',
  DAY_1: 'bg-amber-900/40 text-amber-200 border-amber-800',
  DAY_3: 'bg-orange-900/40 text-orange-200 border-orange-800',
};

function fmtMoney(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export function FollowUpsDuePanel({ scope }: { scope: Scope }) {
  const [items, setItems] = useState<FollowUp[] | null>(null);
  const [target, setTarget] = useState<EmailReviewTarget | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(() => {
    fetch(`/api/sales/follow-ups?scope=${scope}`)
      .then((r) => r.json())
      .then((d) => setItems(d.followUps || []))
      .catch(() => setItems([]));
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  if (items === null) {
    return null; // silent first paint to avoid flicker
  }
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-amber-900">Follow-ups Due</h2>
          <p className="text-[11px] text-amber-800/80 mt-0.5">
            Cadence-generated drafts for quotes still awaiting a response. Review, send, or skip.
          </p>
        </div>
        <span className="text-[11px] font-semibold text-amber-900 bg-amber-200/60 px-2 py-0.5 rounded-full">
          {items.length} pending
        </span>
      </div>

      <ul className="divide-y divide-amber-200/70">
        {items.map((f) => {
          const days = daysSince(f.order.sentAt);
          return (
            <li key={f.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900 truncate">
                    {f.order.job.name}
                  </span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border ${STAGE_TONE[f.stage]}`}>
                    {STAGE_LABEL[f.stage]}
                  </span>
                </div>
                <div className="text-[11px] text-gray-600 truncate">
                  {f.order.company.name}
                  <> · {f.order.agent.name}</>
                  {days != null && <> · sent {days}d ago</>}
                  <> · {fmtMoney(f.order.total)}</>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => {
                    if (shouldReview('followup-order')) {
                      setTarget({ kind: 'followup-order', orderId: f.order.id });
                    }
                  }}
                  disabled={target !== null}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded"
                  title="Review recipient + stage, then send the branded follow-up"
                >
                  Send follow-up
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {feedback && (
        <div
          className={`mt-3 text-[11px] px-3 py-2 rounded ${
            feedback.kind === 'ok'
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              : 'bg-red-100 text-red-800 border border-red-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <EmailReviewModal
        target={target}
        onClose={() => setTarget(null)}
        onSent={(info) => {
          setTarget(null);
          setFeedback({
            kind: 'ok',
            text: `Follow-up sent to ${info.recipient} (${info.orderNumber})`,
          });
          load();
        }}
      />
    </section>
  );
}
