'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ThreadMessage {
  id: string;
  fromAddress: string;
  toAddresses: string[];
  subject: string;
  snippet: string | null;
  direction: string;
  sentAt: string;
}

interface ThreadResponse {
  email: { id: string; subject: string; threadId: string | null };
  thread: { id: string; subject: string | null; lastDirection: string | null } | null;
  messages: ThreadMessage[];
  considered: { inquiryId: string; status: string } | null;
}

type Props = {
  emailId: string | null;
  onClose: () => void;
  onCapture?: (emailId: string) => Promise<void> | void;
  onDismiss?: (emailId: string) => Promise<void> | void;
  busy?: boolean;
};

function fmtWhen(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

function parseName(fromHeader: string) {
  // Try "Name <addr@x>" → "Name". Fall back to the raw header.
  const m = fromHeader.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/);
  if (m) return m[1].trim();
  return fromHeader.trim();
}

export function ThreadDrawer({ emailId, onClose, onCapture, onDismiss, busy }: Props) {
  const router = useRouter();
  const [data, setData] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Load the thread whenever the drawer's email changes.
  useEffect(() => {
    if (!emailId) {
      setData(null);
      setError('');
      return;
    }
    setLoading(true);
    setData(null);
    setError('');
    fetch(`/api/sales/inquiries/thread?emailId=${encodeURIComponent(emailId)}`)
      .then((r) => r.json())
      .then((d: ThreadResponse | { error: string }) => {
        if ('error' in d) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load thread.');
        setLoading(false);
      });
  }, [emailId]);

  // Esc to close.
  useEffect(() => {
    if (!emailId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emailId, onClose]);

  // Focus trap: keep Tab/Shift+Tab inside the drawer.
  useEffect(() => {
    if (!emailId) return;
    // Move initial focus to the close button so screen-readers announce
    // the dialog and keyboard users start inside it.
    closeBtnRef.current?.focus();

    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = drawerRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      const enabled = Array.from(focusables).filter((el) => !el.hasAttribute('disabled'));
      if (enabled.length === 0) return;
      const first = enabled[0];
      const last = enabled[enabled.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onTab);
    return () => window.removeEventListener('keydown', onTab);
  }, [emailId]);

  const goToInquiry = useCallback(() => {
    if (!data?.considered?.inquiryId) return;
    router.push(`/orders/new-quote?inquiryId=${encodeURIComponent(data.considered.inquiryId)}`);
  }, [data, router]);

  if (!emailId) return null;

  const messages = data?.messages || [];
  const threadSubject = data?.thread?.subject || data?.email?.subject || '(no subject)';
  const captured = data?.considered?.status === 'NEW' || data?.considered?.status === 'CONVERTED';
  const dismissed = data?.considered?.status === 'DISMISSED';

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="thread-drawer-title"
        className="fixed right-0 top-0 h-full z-50 w-full sm:w-[560px] max-w-[100vw] bg-white shadow-2xl flex flex-col"
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="min-w-0 flex-1 pr-3">
            <div id="thread-drawer-title" className="text-[15px] font-extrabold text-gray-900 truncate">
              {threadSubject}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {loading
                ? 'Loading thread…'
                : messages.length === 0
                ? 'No messages found'
                : `${messages.length} message${messages.length === 1 ? '' : 's'} on this thread`}
            </p>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close thread preview"
            className="text-gray-400 hover:text-gray-700 text-xl p-1 flex-shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mb-3" />
              <span className="text-[12px]">Loading thread…</span>
            </div>
          )}
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">{error}</div>
          )}

          {!loading && !error && (
            <>
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-100 text-[11px] text-amber-800">
                Showing snippet previews only — Gmail full bodies aren&apos;t synced yet.
              </div>

              {messages.map((m) => {
                const inbound = m.direction === 'inbound' || m.direction === 'INBOUND';
                return (
                  <div
                    key={m.id}
                    className={`rounded-xl border p-3 ${
                      inbound ? 'bg-white border-gray-200' : 'bg-blue-50/40 border-blue-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                            inbound ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {inbound ? 'In' : 'Out'}
                        </span>
                        <span className="text-[12px] font-semibold text-gray-900 truncate">
                          {parseName(m.fromAddress)}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtWhen(m.sentAt)}</span>
                    </div>
                    {m.toAddresses.length > 0 && (
                      <div className="text-[10px] text-gray-400 mb-1.5 truncate">
                        to {m.toAddresses.join(', ')}
                      </div>
                    )}
                    {m.snippet ? (
                      <p className="text-[12px] text-gray-700 whitespace-pre-wrap">{m.snippet}</p>
                    ) : (
                      <p className="text-[12px] text-gray-400 italic">(no preview available)</p>
                    )}
                  </div>
                );
              })}

              {messages.length === 0 && !loading && (
                <div className="text-center py-10 text-gray-400 text-[12px]">No messages on this thread.</div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          {captured ? (
            <button
              onClick={goToInquiry}
              className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[12px] font-bold"
            >
              Open Inquiry →
            </button>
          ) : (
            <>
              <button
                onClick={() => onCapture?.(emailId)}
                disabled={!onCapture || busy || dismissed}
                className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:opacity-50 text-white text-[12px] font-bold"
              >
                {busy ? 'Capturing…' : dismissed ? 'Dismissed' : 'Capture & Quote'}
              </button>
              <button
                onClick={() => onDismiss?.(emailId)}
                disabled={!onDismiss || busy || dismissed}
                className="px-4 py-2.5 rounded-lg bg-gray-100 text-gray-600 text-[12px] font-semibold hover:bg-gray-200 disabled:opacity-50"
              >
                Dismiss
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg bg-gray-100 text-gray-600 text-[12px] font-semibold hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
