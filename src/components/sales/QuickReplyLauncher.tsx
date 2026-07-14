'use client';

/**
 * Shared Quick Reply launch — the single source of truth for how a thread
 * becomes QuickReplyModal inputs, so the Pipeline list row and the
 * ThreadDrawer never disagree.
 *
 * - buildQuickReplyInputs(messages): pure — turns thread messages into the
 *   emailText / defaultRecipientEmail / inboundEmailMessageId the modal needs.
 *   ThreadDrawer (which already has the thread loaded) calls this directly.
 * - <QuickReplyLauncher emailId>: fetches the thread by emailId (the SAME
 *   endpoint the drawer uses), then renders QuickReplyModal. The list row,
 *   which doesn't have the thread loaded, uses this.
 */

import { useEffect, useState } from 'react';
import { QuickReplyModal } from './QuickReplyModal';

export interface QuickReplyThreadMsg {
  id: string;
  fromAddress: string;
  subject: string;
  snippet: string | null;
  bodyText: string | null;
  direction: string;
  sentAt: string;
}

export interface QuickReplyInputs {
  emailText: string;
  defaultRecipientEmail: string | null;
  inboundEmailMessageId: string | null;
}


export function buildQuickReplyInputs(messages: QuickReplyThreadMsg[]): QuickReplyInputs {
  return {
    emailText: (messages || [])
      .map((m) => `── ${m.sentAt} · ${(m.direction || '').toUpperCase()} · ${m.fromAddress}\nSubject: ${m.subject}\n${m.bodyText || m.snippet || ''}`)
      .join('\n\n'),
    defaultRecipientEmail: messages?.[0]?.fromAddress ?? null,
    inboundEmailMessageId:
      (messages || []).find((m) => (m.direction || '').toLowerCase() === 'inbound')?.id ??
      messages?.[0]?.id ??
      null,
  };
}

/** Fetch a thread by emailId, then open QuickReplyModal with the shared inputs. */
export function QuickReplyLauncher({ emailId, onClose, onSent }: { emailId: string; onClose: () => void; onSent?: () => void }) {
  const [messages, setMessages] = useState<QuickReplyThreadMsg[] | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/sales/inquiries/thread?emailId=${encodeURIComponent(emailId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d?.error) { setError(d.error); return; }
        setMessages((d?.messages ?? []) as QuickReplyThreadMsg[]);
        setThreadId((d?.thread?.id as string | undefined) ?? null);
      })
      .catch(() => active && setError('Failed to load the email thread.'));
    return () => { active = false; };
  }, [emailId]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 text-sm text-rose-700" onClick={(e) => e.stopPropagation()}>
          {error}
          <div className="mt-3 text-right"><button onClick={onClose} className="text-gray-600 hover:text-gray-900 text-xs font-medium">Close</button></div>
        </div>
      </div>
    );
  }
  if (messages === null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-xl shadow-xl px-5 py-4 text-sm text-gray-500">Loading the email…</div>
      </div>
    );
  }

  const inputs = buildQuickReplyInputs(messages);
  return (
    <QuickReplyModal
      emailText={inputs.emailText}
      defaultRecipientEmail={inputs.defaultRecipientEmail}
      inboundEmailMessageId={inputs.inboundEmailMessageId}
      threadId={threadId}
      onClose={onClose}
      onSent={() => { onSent?.(); onClose(); }}
    />
  );
}
