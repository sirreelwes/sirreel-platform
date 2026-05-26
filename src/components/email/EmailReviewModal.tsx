'use client';

/**
 * Universal "review before send" modal for any agent-initiated client
 * email. One component, both flows (quote-send + Mode A follow-up):
 * `target` discriminates which preview + send endpoints to hit.
 *
 * Flow:
 *   1. On open: POST {previewEndpoint} with the body params → composer
 *      returns { to, alternatives, from, subject, html, attachments[],
 *      ... }. NO mint, NO Resend, NO writes.
 *   2. Render: To strip (with "Change recipient" picker over
 *      alternatives), From row (explicit), Subject, sandboxed iframe
 *      with the HTML body via srcDoc, attachment chips, annotation
 *      that the portal CTA gets tokenized at send time.
 *   3. On "Send": POST {sendEndpoint} with the same params + the
 *      override (if the agent picked a different contact). Real send
 *      mints the token + dispatches + writes state.
 *   4. On "Cancel": close, no state touched anywhere.
 *
 * Sandbox: the iframe carries an empty `sandbox` attribute (no
 * allow-scripts, no allow-same-origin, no allow-top-navigation). This
 * makes the preview a strict containment box — any link click in the
 * tokenless preview body is dead, no script can fire, no parent nav
 * can happen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface RankedContact {
  id: string;
  name: string;
  email: string;
  role: string | null;
  isPrimary: boolean;
}

interface AttachmentMeta {
  filename: string;
  mimeType: string;
  sizeBytes?: number;
}

interface CompositionOk {
  ok: true;
  to: RankedContact;
  alternatives: RankedContact[];
  from: string;
  subject: string;
  html: string;
  text: string;
  attachments: AttachmentMeta[];
  order: {
    id: string;
    orderNumber: string;
    jobName: string | null;
    portalSlug: string | null;
    validUntil?: string | null;
  };
  portalUrlIsTokenized: boolean;
  // Follow-up only:
  stage?: 'STAGE_1' | 'STAGE_2' | 'STAGE_3';
  isResend?: boolean;
}

export type EmailReviewTarget =
  | { kind: 'quote'; orderId: string; message?: string | null }
  | {
      kind: 'followup-order';
      orderId: string;
      stage?: 'STAGE_1' | 'STAGE_2' | 'STAGE_3' | null;
      message?: string | null;
    }
  | { kind: 'followup-job'; jobId: string; message?: string | null };

interface Props {
  target: EmailReviewTarget | null;
  onClose: () => void;
  /** Called after a successful real send. The caller refreshes its
   *  list / shows a toast / etc. */
  onSent: (info: { recipient: string; orderNumber: string; stage?: string }) => void;
}

const STAGE_LABEL: Record<'STAGE_1' | 'STAGE_2' | 'STAGE_3', string> = {
  STAGE_1: 'Check-in #1 — did the quote land?',
  STAGE_2: 'Check-in #2 — still on track?',
  STAGE_3: 'Check-in #3 — quote window closing',
};

function endpointsFor(target: EmailReviewTarget): { preview: string; send: string; titleKind: string } {
  switch (target.kind) {
    case 'quote':
      return {
        preview: `/api/orders/${target.orderId}/send-quote/preview`,
        send: `/api/orders/${target.orderId}/send-quote`,
        titleKind: 'Quote email',
      };
    case 'followup-order':
      return {
        preview: `/api/orders/${target.orderId}/follow-ups/send/preview`,
        send: `/api/orders/${target.orderId}/follow-ups/send`,
        titleKind: 'Follow-up email',
      };
    case 'followup-job':
      return {
        preview: `/api/jobs/${target.jobId}/follow-ups/send/preview`,
        send: `/api/jobs/${target.jobId}/follow-ups/send`,
        titleKind: 'Follow-up email',
      };
  }
}

function buildPreviewBody(target: EmailReviewTarget, overrideContactId: string | null): unknown {
  const base: Record<string, unknown> = {};
  if (overrideContactId) base.overrideContactId = overrideContactId;
  if ('message' in target && target.message) base.message = target.message;
  if (target.kind === 'followup-order' && target.stage) base.stage = target.stage;
  return base;
}

function buildSendBody(target: EmailReviewTarget, overrideContactId: string | null): unknown {
  return buildPreviewBody(target, overrideContactId);
}

function formatSize(bytes: number | undefined): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EmailReviewModal({ target, onClose, onSent }: Props) {
  const [preview, setPreview] = useState<CompositionOk | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideContactId, setOverrideContactId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const endpoints = useMemo(() => (target ? endpointsFor(target) : null), [target]);

  // Fetch the preview. Re-fires when the agent picks a different
  // recipient (overrideContactId changes) — composer re-renders the
  // body / re-applies any greeting personalization for the new contact.
  const fetchPreview = useCallback(async () => {
    if (!target || !endpoints) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoints.preview, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPreviewBody(target, overrideContactId)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        setError(json?.error || `Preview failed (${res.status})`);
        setPreview(null);
      } else {
        setPreview(json as CompositionOk);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [target, endpoints, overrideContactId]);

  // Reset state when target changes (e.g. opening for a different order).
  useEffect(() => {
    if (!target) return;
    setOverrideContactId(null);
    setShowPicker(false);
  }, [target]);

  useEffect(() => {
    if (target) void fetchPreview();
  }, [target, fetchPreview]);

  if (!target || !endpoints) return null;

  const handleSend = async () => {
    if (!preview) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(endpoints.send, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSendBody(target, overrideContactId)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        setError(json?.error || 'Send failed');
        return;
      }
      onSent({
        recipient: preview.to.email,
        orderNumber: preview.order.orderNumber,
        stage: preview.stage,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const stageLabel = preview?.stage ? STAGE_LABEL[preview.stage] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">Review before send</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {endpoints.titleKind}
              {preview && (
                <>
                  {' · '}
                  {preview.order.jobName ?? preview.order.orderNumber}
                  {' · '}
                  <span className="font-mono">{preview.order.orderNumber}</span>
                </>
              )}
              {stageLabel && <> · <span className="text-amber-400">{stageLabel}</span></>}
              {preview?.isResend && <> · <span className="text-blue-300">resend</span></>}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="text-zinc-500 hover:text-white text-xl leading-none disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading && <p className="text-xs text-zinc-500">Loading preview…</p>}

          {!loading && error && (
            <div className="text-xs text-red-300 bg-red-900/20 border border-red-900/60 rounded px-3 py-2">
              {error}
            </div>
          )}

          {preview && (
            <>
              {/* To strip — picker collapsed by default */}
              <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">To</div>
                    <div className="text-white text-sm truncate">
                      {preview.to.name}
                      <span className="text-zinc-400 font-mono ml-2">&lt;{preview.to.email}&gt;</span>
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {preview.to.role ?? 'Contact'}
                      {preview.to.isPrimary && <span className="text-emerald-400"> · primary</span>}
                    </div>
                  </div>
                  {preview.alternatives.length > 0 && (
                    <button
                      onClick={() => setShowPicker((s) => !s)}
                      className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 px-2 py-1 rounded hover:bg-amber-900/20"
                    >
                      {showPicker ? 'Hide' : 'Change recipient'}
                    </button>
                  )}
                </div>
                {showPicker && preview.alternatives.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-zinc-800 space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                      Other contacts on this {target.kind === 'followup-job' ? 'job' : 'order'}
                    </div>
                    {preview.alternatives.map((alt) => (
                      <button
                        key={alt.id}
                        onClick={() => { setOverrideContactId(alt.id); setShowPicker(false); }}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-800 transition"
                      >
                        <div className="text-sm text-white">
                          {alt.name}
                          <span className="text-zinc-400 font-mono ml-2 text-[12px]">&lt;{alt.email}&gt;</span>
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {alt.role ?? 'Contact'}
                          {alt.isPrimary && <span className="text-emerald-400"> · primary</span>}
                        </div>
                      </button>
                    ))}
                    {overrideContactId !== null && (
                      <button
                        onClick={() => { setOverrideContactId(null); setShowPicker(false); }}
                        className="text-[11px] text-zinc-500 hover:text-zinc-300 px-2 py-1"
                      >
                        Reset to default recipient
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* From row */}
              <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">From</div>
                <div className="text-white text-sm font-mono">{preview.from}</div>
              </div>

              {/* Subject */}
              <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">Subject</div>
                <div className="text-white text-sm">{preview.subject}</div>
              </div>

              {/* Body iframe — sandbox="" (empty) = strict containment */}
              <div className="bg-white border border-zinc-800 rounded-lg overflow-hidden">
                <iframe
                  srcDoc={preview.html}
                  sandbox=""
                  title="Email body preview"
                  className="w-full"
                  style={{ height: '480px', border: 'none' }}
                />
              </div>

              {/* Portal CTA annotation */}
              {preview.order.portalSlug && (
                <div className="text-[11px] text-zinc-500 italic px-1">
                  The portal CTA in this preview is unlinked. On send, it will be secured with
                  a magic-link token tied to the chosen recipient.
                </div>
              )}

              {/* Attachments */}
              {preview.attachments.length > 0 && (
                <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                    Attachments
                  </div>
                  <div className="space-y-1">
                    {preview.attachments.map((a) => (
                      <div key={a.filename} className="flex items-center gap-2 text-sm">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        <span className="text-zinc-200 font-mono">{a.filename}</span>
                        <span className="text-[11px] text-zinc-500">
                          {a.mimeType}
                          {formatSize(a.sizeBytes) && <> · {formatSize(a.sizeBytes)}</>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2 flex-shrink-0">
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
