'use client';

/**
 * Lightweight templated-only confirm before firing a branded follow-up.
 * Used by both pipeline surfaces (FollowUpsDuePanel + OpenQuotesKanban)
 * so agents see WHO and WHICH STAGE before committing — no free-text
 * field per the STEP 2 decision; the existing template body goes out
 * unchanged.
 *
 * Mount this with a `target` (either { kind: 'order', id } or
 * { kind: 'job', id }) and the dialog will:
 *
 *   1. POST to the matching endpoint with { dryRun: true } to resolve
 *      the would-be recipient + STAGE_N without sending or writing
 *      any state. Surfaces any gating errors (paused, no recipient,
 *      no SENT order on a Job) before the agent commits.
 *   2. Show recipient + stage + order/job context in a small card.
 *   3. On confirm, POST again WITHOUT dryRun — the real send. On
 *      success, call onSent(); on error, surface inline.
 *
 * No external state, no toast plumbing — caller renders its own
 * feedback in response to onSent.
 */

import { useEffect, useState } from 'react';

type Stage = 'STAGE_1' | 'STAGE_2' | 'STAGE_3';

const STAGE_LABEL: Record<Stage, string> = {
  STAGE_1: 'Check-in #1 — did the quote land?',
  STAGE_2: 'Check-in #2 — still on track?',
  STAGE_3: 'Check-in #3 — quote window closing',
};

export type FollowUpTarget =
  | { kind: 'order'; id: string }
  | { kind: 'job'; id: string };

interface DryRunResponse {
  ok: true;
  dryRun: true;
  stage: Stage;
  recipient: { email: string; name: string; role: string | null };
  order: {
    id: string;
    orderNumber: string;
    jobName: string | null;
    validUntil: string | null;
  };
  isResend: boolean;
}

function endpointFor(target: FollowUpTarget): string {
  return target.kind === 'order'
    ? `/api/orders/${target.id}/follow-ups/send`
    : `/api/jobs/${target.id}/follow-ups/send`;
}

interface Props {
  target: FollowUpTarget | null;
  onClose: () => void;
  onSent: (info: { recipient: string; stage: Stage; orderNumber: string }) => void;
}

export function FollowUpConfirmDialog({ target, onClose, onSent }: Props) {
  const [preview, setPreview] = useState<DryRunResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setPreview(null);
    setLoading(true);
    setError(null);

    fetch(endpointFor(target), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || j?.ok === false) {
          setError(j?.error || `Preview failed (${r.status})`);
        } else {
          setPreview(j as DryRunResponse);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Preview failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!target) return null;

  const handleSend = async () => {
    if (!preview) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(endpointFor(target), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        setError(json?.error || 'Send failed');
        return;
      }
      onSent({
        recipient: preview.recipient.email,
        stage: preview.stage,
        orderNumber: preview.order.orderNumber,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Send follow-up</h2>
          <button
            onClick={onClose}
            disabled={sending}
            className="text-zinc-500 hover:text-white text-xl leading-none disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-3 text-sm">
          {loading && <p className="text-zinc-500 text-xs">Resolving recipient + stage…</p>}

          {!loading && error && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/60 rounded px-3 py-2">
              {error}
            </p>
          )}

          {preview && (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">To</div>
                <div className="text-white font-mono text-[13px] truncate">
                  {preview.recipient.email}
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {preview.recipient.name}
                  {preview.recipient.role && (
                    <span className="text-zinc-600"> · {preview.recipient.role}</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">Stage</div>
                <div className="text-amber-300 text-[13px]">{STAGE_LABEL[preview.stage]}</div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">
                  About
                </div>
                <div className="text-white text-[13px] truncate">
                  {preview.order.jobName ?? preview.order.orderNumber}
                  <span className="text-zinc-500"> · {preview.order.orderNumber}</span>
                </div>
                {preview.order.validUntil && (
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Quote valid through{' '}
                    {new Date(preview.order.validUntil).toLocaleDateString()}
                  </div>
                )}
              </div>

              <p className="text-[11px] text-zinc-500 pt-1">
                Branded HTML email from{' '}
                <span className="font-mono text-zinc-400">notifications@sirreel.com</span>.
                Includes portal link and supply-order link.
              </p>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-3 py-2 text-zinc-400 hover:text-white text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleSend(); }}
            disabled={!preview || sending || loading}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
