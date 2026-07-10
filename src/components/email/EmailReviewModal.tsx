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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isHighRiskEmailDomain } from '@/lib/email/emailDomain';

/**
 * Small debounce hook — used to delay re-fetching the live preview
 * while the agent is typing in the personal-note textarea. Stops the
 * server from servicing one request per keystroke; gives the agent
 * time to finish a thought before the body re-renders.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

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
  // Quick Reply only — rep-facing fleet-utilization detail behind the draft's
  // availability tier. Never rendered in the client email itself.
  quickReplyInsight?: QuickReplyInsight;
}

interface QuickReplyInsight {
  tier: 'positive' | 'noncommittal';
  datesParsed: boolean;
  pickup: string | null;
  return: string | null;
  categories: {
    id: string;
    name: string;
    requested: number;
    activeAssets: number;
    /** Peak-day committed ÷ active; null when the category has zero active assets. */
    utilization: number | null;
    tight: boolean;
  }[];
}

export interface QuickReplyPayload {
  recipientEmail: string;
  recipientName: string | null;
  clientName: string | null;
  jobName: string | null;
  pickup: string | null;
  return: string | null;
  categories: { id: string; name: string; quantity: number }[];
  /** Fold a request for the production company + project name into the reply. */
  askForDetails: boolean;
  /** Rep's own message (Write-my-own mode) — replaces the templated prose; the
   *  branded shell + real availability block + supply CTA stay intact. */
  customMessage?: string | null;
  /** EmailMessage id of the inbound being replied to — drives CRM capture on send. */
  inboundEmailMessageId: string | null;
}

export type EmailReviewTarget =
  | { kind: 'quote'; orderId: string; message?: string | null }
  | {
      kind: 'followup-order';
      orderId: string;
      stage?: 'STAGE_1' | 'STAGE_2' | 'STAGE_3' | null;
      message?: string | null;
    }
  | { kind: 'followup-job'; jobId: string; message?: string | null }
  | { kind: 'quick-reply'; payload: QuickReplyPayload; message?: string | null }
  // Welcome / Job Begin invite — server derives everything from the inquiry;
  // the send mints the WelcomeInvite token, and the Job is created only when
  // the client clicks "Get Paperwork Started".
  | { kind: 'welcome'; inquiryId: string; message?: string | null };

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
    case 'quick-reply':
      return {
        preview: `/api/sales/quick-reply/preview`,
        send: `/api/sales/quick-reply/send`,
        titleKind: 'Quick reply',
      };
    case 'welcome':
      return {
        preview: `/api/sales/welcome/preview`,
        send: `/api/sales/welcome/send`,
        titleKind: 'Welcome email',
      };
  }
}

function buildPreviewBody(
  target: EmailReviewTarget,
  overrideContactId: string | null,
  customNote: string,
  customMessage = '',
): unknown {
  const base: Record<string, unknown> = {};
  if (overrideContactId) base.overrideContactId = overrideContactId;
  // Caller's pre-seeded message + the agent's modal-typed note. Agent's
  // typed value wins when both are present (the modal IS the review
  // surface — anything typed here is the final word). composers escape
  // + newline-convert before injecting into the body.
  const finalNote = customNote.trim() || (('message' in target && target.message) || '');
  if (finalNote) base.message = finalNote;
  if (target.kind === 'followup-order' && target.stage) base.stage = target.stage;
  // Quick Reply has no order/job to key off — it carries its parsed payload
  // (recipient, client/job, dates, requested categories) through the body.
  // In "Write my own" mode the rep's customMessage rides along the payload and
  // replaces the templated prose (the availability block + shell stay).
  if (target.kind === 'quick-reply') {
    base.payload = { ...target.payload, customMessage: customMessage.trim() || null };
  }
  // Welcome invite: the server derives recipient/company/agent from the
  // inquiry; only the id + the agent's words travel in the body.
  if (target.kind === 'welcome') {
    base.inquiryId = target.inquiryId;
    base.customMessage = customMessage.trim() || null;
  }
  return base;
}

function buildSendBody(
  target: EmailReviewTarget,
  overrideContactId: string | null,
  customNote: string,
  customMessage = '',
): unknown {
  return buildPreviewBody(target, overrideContactId, customNote, customMessage);
}

function formatSize(bytes: number | undefined): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtInsightDate(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function EmailReviewModal({ target, onClose, onSent }: Props) {
  const [preview, setPreview] = useState<CompositionOk | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Three send states:
  //   'idle'      — Send button is live
  //   'in-flight' — request in motion; button disabled + spinner label
  //   'sent'      — request resolved; button disabled, modal about to
  //                 close via onSent callback (next paint).
  // The first transition (idle → in-flight) is latched synchronously
  // via a ref so a fast double-click can't enqueue two sends before
  // React re-renders the disabled state.
  const [sendState, setSendState] = useState<'idle' | 'in-flight' | 'sent'>('idle');
  const sendInFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideContactId, setOverrideContactId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  // Personal-note textarea state. Empty = templated-only (the
  // composers omit the customMessage block). Debounced before it
  // flows into the live preview re-fetch.
  const [customNote, setCustomNote] = useState('');
  const debouncedNote = useDebouncedValue(customNote, 350);
  // "Write my own email" (quick-reply only): the rep's own prose replaces the
  // templated body; the branded shell + real availability block stay. Debounced
  // into the live preview re-fetch like the note.
  const [writeOwn, setWriteOwn] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const debouncedCustom = useDebouncedValue(writeOwn ? customMessage : '', 350);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFlags, setAiFlags] = useState<string[] | null>(null);
  const [aiPolished, setAiPolished] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const endpoints = useMemo(() => (target ? endpointsFor(target) : null), [target]);

  // Fetch the preview. Re-fires when the agent picks a different
  // recipient, types in the personal-note textarea (debounced), or
  // re-opens the modal for a new target.
  //
  // Loading vs refreshing: first fetch sets `loading` (skeleton).
  // Subsequent fetches set `refreshing` and KEEP the prior preview
  // visible so the iframe doesn't flicker / scroll-reset while the
  // agent is typing a note.
  const fetchPreview = useCallback(
    async (isInitial: boolean) => {
      if (!target || !endpoints) return;
      if (isInitial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await fetch(endpoints.preview, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPreviewBody(target, overrideContactId, debouncedNote, debouncedCustom)),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.ok === false) {
          setError(json?.error || `Preview failed (${res.status})`);
          if (isInitial) setPreview(null);
          // Refresh failure: keep the prior preview visible, just
          // surface the error — better than wiping the modal.
        } else {
          setPreview(json as CompositionOk);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Preview failed');
        if (isInitial) setPreview(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [target, endpoints, overrideContactId, debouncedNote, debouncedCustom],
  );

  // Reset state when target changes (e.g. opening for a different order).
  useEffect(() => {
    if (!target) return;
    setOverrideContactId(null);
    setShowPicker(false);
    setCustomNote('');
    setWriteOwn(false);
    setCustomMessage('');
    setAiFlags(null);
    setAiPolished(null);
    setAiError(null);
    sendInFlightRef.current = false;
    setSendState('idle');
  }, [target]);

  // Initial fetch when target changes.
  useEffect(() => {
    if (target) void fetchPreview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, endpoints]);

  // Refetch (non-initial) when recipient or debounced note changes —
  // only after the first preview has landed.
  useEffect(() => {
    if (!target || preview === null) return;
    void fetchPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideContactId, debouncedNote, debouncedCustom]);

  if (!target || !endpoints) return null;

  const handleSend = async () => {
    if (!preview) return;
    // Synchronous ref latch — wins the race against a fast double-
    // click. React's setState is async (setSendState below would
    // re-render on the next tick), so without this guard two clicks
    // in a single frame both pass the !preview check and both fire
    // the fetch. Ref reads/writes are synchronous; second invocation
    // sees the latch set and returns immediately.
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setSendState('in-flight');
    setError(null);
    try {
      const res = await fetch(endpoints.send, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSendBody(target, overrideContactId, customNote, writeOwn ? customMessage : '')),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        setError(json?.error || 'Send failed');
        // Failure: release the latch so the agent can retry.
        sendInFlightRef.current = false;
        setSendState('idle');
        return;
      }
      // Success: stay latched. The component is about to unmount via
      // onSent → caller's setTarget(null). Keep the button disabled
      // until then so the "Send" label doesn't briefly flicker back
      // to active right before the modal closes.
      setSendState('sent');
      onSent({
        recipient: preview.to.email,
        orderNumber: preview.order.orderNumber,
        stage: preview.stage,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
      sendInFlightRef.current = false;
      setSendState('idle');
    }
  };

  // AI pass over the rep's custom message — server reuses the parse Anthropic
  // pattern and recomputes the REAL availability so it can catch a
  // contradiction. Returns flags + a polished rewrite; nothing auto-applies.
  const runAiReview = async () => {
    if (target.kind !== 'quick-reply' || !customMessage.trim()) return;
    setAiBusy(true);
    setAiError(null);
    setAiFlags(null);
    setAiPolished(null);
    try {
      const p = target.payload;
      const res = await fetch('/api/sales/quick-reply/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: customMessage, categories: p.categories, pickup: p.pickup, return: p.return, jobName: p.jobName }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) { setAiError(json?.error || `AI review failed (${res.status})`); return; }
      setAiFlags(Array.isArray(json.flags) ? json.flags : []);
      setAiPolished(typeof json.polished === 'string' ? json.polished : null);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI review failed');
    } finally {
      setAiBusy(false);
    }
  };

  const stageLabel = preview?.stage ? STAGE_LABEL[preview.stage] : null;
  // Derived: any non-idle send state freezes the modal's interactive
  // controls (close button, textarea, recipient picker, Send button).
  const sendLocked = sendState !== 'idle';

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
            disabled={sendLocked}
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
                      {isHighRiskEmailDomain(preview.to.email) && (
                        <span
                          className="ml-2 inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg whitespace-nowrap align-middle"
                          title="Apple iCloud may silently filter mail to this address."
                        >
                          iCloud — may be filtered
                        </span>
                      )}
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
                          {isHighRiskEmailDomain(alt.email) && (
                            <span
                              className="ml-2 inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg whitespace-nowrap align-middle"
                              title="Apple iCloud may silently filter mail to this address."
                            >
                              iCloud — may be filtered
                            </span>
                          )}
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

              {/* Personal note — flows into the composer's customMessage
                  slot in BOTH the live preview below and the real send.
                  Optional; empty leaves the email purely templated. The
                  locked brand shell (header, CTAs, footer) is unaffected. */}
              <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Personal note (optional)
                  </label>
                  {refreshing && (
                    <span className="text-[10px] text-amber-300 animate-pulse">
                      Updating preview…
                    </span>
                  )}
                </div>
                <textarea
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  disabled={sendLocked}
                  rows={3}
                  maxLength={5000}
                  placeholder="Add a sentence or two above the standard close. Empty = templated-only."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 resize-y disabled:opacity-50"
                />
              </div>

              {/* Write my own email — quick-reply + welcome. Replaces the
                  templated prose with the rep's message; the branded shell +
                  structural blocks (availability / portal CTA) stay intact. */}
              {(target.kind === 'quick-reply' || target.kind === 'welcome') && (
                <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg px-3 py-2">
                  <label className="flex items-center gap-2 text-[12px] text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={writeOwn}
                      disabled={sendLocked}
                      onChange={(e) => { setWriteOwn(e.target.checked); if (!e.target.checked) { setAiFlags(null); setAiPolished(null); setAiError(null); } }}
                      className="accent-amber-600"
                    />
                    <span>Write my own email <span className="text-zinc-500">— your message replaces the standard wording; {target.kind === 'welcome' ? 'the portal button & sign-off stay.' : 'the availability list & supply link stay.'}</span></span>
                  </label>
                  {writeOwn && (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={customMessage}
                        onChange={(e) => setCustomMessage(e.target.value)}
                        disabled={sendLocked}
                        rows={5}
                        maxLength={5000}
                        placeholder="Write your message to the client. It appears under the greeting, above the real availability block."
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 resize-y disabled:opacity-50"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={runAiReview}
                          disabled={aiBusy || sendLocked || !customMessage.trim()}
                          className="text-[12px] font-semibold border border-zinc-600 text-zinc-200 hover:border-amber-500 hover:text-white disabled:opacity-40 px-3 py-1.5 rounded-lg"
                        >
                          {aiBusy ? 'Reviewing…' : 'Review with AI'}
                        </button>
                        <span className="text-[10px] text-zinc-500">Flags risks + offers a polished version. Optional — nothing auto-applies.</span>
                      </div>
                      {aiError && <div className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-900 rounded px-2 py-1">{aiError}</div>}
                      {aiFlags && (
                        aiFlags.length > 0 ? (
                          <div className="text-[11px] text-amber-200 bg-amber-950/30 border border-amber-900 rounded px-2.5 py-1.5">
                            <div className="font-bold mb-0.5">AI flagged {aiFlags.length} thing{aiFlags.length === 1 ? '' : 's'}:</div>
                            <ul className="list-disc list-inside space-y-0.5">{aiFlags.map((f, i) => <li key={i}>{f}</li>)}</ul>
                          </div>
                        ) : (
                          <div className="text-[11px] text-emerald-300 bg-emerald-950/30 border border-emerald-900 rounded px-2.5 py-1.5">AI found no issues — no availability contradictions.</div>
                        )
                      )}
                      {aiPolished && aiPolished.trim() && aiPolished.trim() !== customMessage.trim() && (
                        <div className="bg-zinc-900 border border-zinc-700 rounded px-2.5 py-2">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Polished version</div>
                          <div className="text-[12px] text-zinc-200 whitespace-pre-wrap leading-relaxed">{aiPolished}</div>
                          <button
                            onClick={() => { setCustomMessage(aiPolished); setAiPolished(null); }}
                            disabled={sendLocked}
                            className="mt-1.5 text-[11px] font-semibold text-amber-300 hover:text-amber-200 disabled:opacity-40"
                          >
                            Use this version →
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Quick Reply utilization strip — rep-only visibility into the
                  fleet math behind the draft's availability tier. The client
                  email never carries these numbers. */}
              {preview.quickReplyInsight && (() => {
                const qi = preview.quickReplyInsight;
                const start = fmtInsightDate(qi.pickup);
                const end = fmtInsightDate(qi.return);
                const dates = start && end ? `${start} – ${end}` : start ? `starting ${start}` : 'not parsed';
                return (
                  <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                        Fleet utilization — internal, not shown to client
                      </div>
                      <span
                        className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                          qi.tier === 'positive'
                            ? 'bg-emerald-950/40 text-emerald-300 border-emerald-900'
                            : 'bg-amber-950/40 text-amber-300 border-amber-900'
                        }`}
                      >
                        {qi.tier === 'positive' ? 'Positive tier' : 'Non-committal tier'}
                      </span>
                    </div>
                    <div className="text-[12px] text-zinc-300">
                      <span className="text-zinc-500">Dates</span> · {dates}
                    </div>
                    {qi.categories.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {qi.categories.map((c) => (
                          <span
                            key={c.id}
                            className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${
                              c.tight
                                ? 'bg-rose-950/40 text-rose-300 border-rose-900'
                                : 'bg-zinc-900 text-zinc-300 border-zinc-700'
                            }`}
                            title={
                              c.utilization === null
                                ? 'No active units in this category'
                                : `Peak day: ${Math.round(c.utilization * 100)}% of ${c.activeAssets} active unit${c.activeAssets === 1 ? '' : 's'} committed`
                            }
                          >
                            {c.name}
                            <span className={c.tight ? 'font-bold' : 'text-zinc-500'}>
                              {c.utilization === null ? 'no active units' : `${Math.round(c.utilization * 100)}%`}
                            </span>
                            {c.tight && <span aria-hidden>⚠</span>}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1 text-[11px] text-zinc-500">
                        {qi.datesParsed
                          ? 'No vehicle categories identified — non-committal wording used.'
                          : 'Dates could not be parsed from the inquiry — non-committal wording used.'}
                      </div>
                    )}
                  </div>
                );
              })()}

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

        {/* iCloud deliverability warning — non-blocking. Shows when
            the chosen To is on an Apple-filtered domain (me/icloud/mac
            .com). The send isn't gated; the agent confirms receipt or
            uses another channel. */}
        {preview && isHighRiskEmailDomain(preview.to.email) && (
          <div className="px-5 pt-3 flex-shrink-0">
            <div className="rounded-md border border-chip-warn-fg/30 bg-chip-warn-bg text-chip-warn-fg px-3 py-2 text-[12px] leading-snug">
              <span className="font-bold uppercase tracking-wider text-[10px]">iCloud deliverability</span>
              <span className="block mt-0.5">
                This is an iCloud address — Apple may silently filter it. Confirm the client received it, or send the portal link another way.
              </span>
            </div>
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={sendLocked}
            className="px-3 py-2 text-zinc-400 hover:text-white text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleSend(); }}
            disabled={!preview || sendLocked || loading}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg"
          >
            {sendState === 'in-flight' ? 'Sending…' : sendState === 'sent' ? 'Sent ✓' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
