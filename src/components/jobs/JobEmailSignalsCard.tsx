'use client';

/**
 * Change-of-plan suggestions from client email, on the job page.
 *
 * Wes 2026-09-11: "there can be nuance in a client's cancelling or
 * changing of a job — any changes to HQ are gated with a confirmation or
 * suggestion." This card IS the gate. Each row quotes the sentence that
 * raised it and asks a person to decide:
 *
 *   Mark lost…     (CANCEL only) opens the existing MarkLostModal — the
 *                  same audited path, hold-release checkboxes included.
 *                  Nothing is pre-ticked; the modal decides nothing.
 *   Handled        the client meant it and the change has been made (or
 *                  is being made) through the normal controls: status
 *                  menu for a hold, the order's dates for a move/extend.
 *   Not a change   a false positive ("cancel the cube" was one line item;
 *                  "on hold" was the client's own schedule).
 *
 * Renders nothing while there are no open suggestions — a job page must
 * not carry an empty "no suggestions" box. Light shell: lt-* / chip-*
 * tokens, no raw zinc.
 */

import { useCallback, useEffect, useState } from 'react';

type Kind = 'CANCEL' | 'HOLD' | 'DATE_CHANGE' | 'EXTEND' | 'RETURN_EARLY';

interface Signal {
  id: string;
  kind: Kind;
  status: 'OPEN' | 'CONFIRMED' | 'DISMISSED';
  evidence: string[];
  linkedBy: string[];
  summary: string | null;
  createdAt: string;
  message: {
    id: string;
    threadId: string | null;
    fromAddress: string;
    subject: string;
    sentAt: string;
    snippet: string | null;
  };
}

const HEADLINE: Record<Kind, string> = {
  CANCEL: 'Client may be cancelling',
  HOLD: 'Client may be putting this on hold',
  DATE_CHANGE: 'Client may be moving the dates',
  EXTEND: 'Client may be extending',
  RETURN_EARLY: 'Client may be returning early',
};

const NEXT_STEP: Record<Kind, string> = {
  CANCEL: 'If so, Mark lost… releases the units with the usual confirmation. Nothing has been changed.',
  HOLD: 'If so, set the job to Hold from the status menu. Nothing has been changed.',
  DATE_CHANGE: 'If so, change the dates on the order. Nothing has been changed.',
  EXTEND: 'If so, extend the dates on the order and check the units are free. Nothing has been changed.',
  RETURN_EARLY: 'If so, shorten the order and let the yard know. Nothing has been changed.',
};

const LINK_LABEL: Record<string, string> = {
  thread: 'this job’s thread',
  contact: 'a contact on this job',
  domain: 'the production company’s domain',
  subject: 'the order number in the subject',
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface Props {
  jobId: string;
  /** Opens the page's MarkLostModal — the only path that changes the job. */
  onMarkLost: () => void;
}

export function JobEmailSignalsCard({ jobId, onMarkLost }: Props) {
  const [open, setOpen] = useState<Signal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/email-signals`);
      if (!res.ok) return;
      const data = (await res.json()) as { open: Signal[] };
      setOpen(data.open ?? []);
    } catch {
      /* the card is optional; a failed load shows nothing */
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (signalId: string, action: 'confirm' | 'dismiss') => {
    setBusy(signalId);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/email-signals/${signalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || 'Could not update');
      }
      setOpen((prev) => prev.filter((s) => s.id !== signalId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  };

  if (open.length === 0) return null;

  return (
    <section id="email-signals" className="mt-5 rounded-xl border border-chip-warn-fg/30 bg-chip-warn-bg p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-chip-warn-fg">
          From the client’s email — needs a decision
        </h2>
        <span className="text-[12px] text-lt-fg3">
          {open.length === 1 ? '1 suggestion' : `${open.length} suggestions`} · nothing applied automatically
        </span>
      </div>

      <ul className="mt-3 space-y-3">
        {open.map((s) => (
          <li key={s.id} className="rounded-lg bg-lt-card border border-lt-hairline p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="text-[15px] font-semibold text-lt-fg">{HEADLINE[s.kind]}</div>
              <div className="text-[12px] text-lt-fg3">
                {s.message.fromAddress} · {fmtWhen(s.message.sentAt)}
              </div>
            </div>
            <div className="mt-1 text-[13px] text-lt-fg2">
              <span className="italic">“{s.message.subject || '(no subject)'}”</span>
              {s.summary ? <span> — {s.summary}</span> : s.message.snippet ? <span> — {s.message.snippet}</span> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.evidence.map((e) => (
                <span key={e} className="rounded-full bg-chip-warn-bg text-chip-warn-fg px-2 py-0.5 text-[12px]">
                  {e}
                </span>
              ))}
              {s.linkedBy.length > 0 && (
                <span className="rounded-full bg-chip-neutral-bg text-chip-neutral-fg px-2 py-0.5 text-[12px]">
                  matched via {s.linkedBy.map((l) => LINK_LABEL[l] ?? l).join(', ')}
                </span>
              )}
            </div>
            <p className="mt-2 text-[13px] text-lt-fg3">{NEXT_STEP[s.kind]}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {s.kind === 'CANCEL' && (
                <button
                  type="button"
                  onClick={onMarkLost}
                  className="text-[13px] font-semibold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg"
                >
                  Mark lost…
                </button>
              )}
              {s.message.threadId && (
                <a
                  href={`/jobs/${jobId}?thread=${s.message.threadId}`}
                  className="text-[13px] font-medium text-lt-fg2 hover:text-lt-fg underline underline-offset-2"
                >
                  Read the email
                </a>
              )}
              <span className="flex-1" />
              <button
                type="button"
                disabled={busy === s.id}
                onClick={() => resolve(s.id, 'confirm')}
                className="text-[13px] font-medium text-lt-fg2 hover:text-lt-fg px-3 py-1.5 rounded-lg border border-lt-hairline bg-lt-card disabled:opacity-50"
              >
                Handled
              </button>
              <button
                type="button"
                disabled={busy === s.id}
                onClick={() => resolve(s.id, 'dismiss')}
                className="text-[13px] font-medium text-lt-fg3 hover:text-lt-fg px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                Not a change
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <div className="mt-2 text-[13px] text-chip-bad-fg">{error}</div>}
    </section>
  );
}
