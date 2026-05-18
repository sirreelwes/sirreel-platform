'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormTypeBadge, type FormType } from './FormTypeBadge';

interface ExtractedMessage {
  contact: { name: string | null; email: string | null; phone: string | null; title: string | null };
  company: string | null;
  jobIntent: {
    vehicleType: string | null;
    equipment: string[];
    pickupDate: string | null;
    returnDate: string | null;
    duration: string | null;
    location: string | null;
    projectName: string | null;
  };
  urgency: 'asap' | 'normal' | 'future' | null;
  rawNotes: string | null;
  messageNature: string;
  summary: string;
  confidence: number;
}

interface ThreadMessage {
  id: string;
  fromAddress: string;
  toAddresses: string[];
  subject: string;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  bodySource: string | null;
  attachmentCount: number;
  direction: string;
  sentAt: string;
  extractedData: ExtractedMessage | null;
  extractionConfidence: number | null;
  extractionRunAt: string | null;
  inferredFormType: FormType | null;
}

// Display name for sirreel agent inboxes — Gmail's "From" header on
// outbound mail often surfaces only "SirReel" (the org alias), losing the
// actual agent. Map the email local-part back to a human name so the
// drawer shows "Oliver Carlson" instead of "SirReel" on an outbound row.
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  'info': 'SirReel (info)',
  'jose': 'Jose Pacheco',
  'oliver': 'Oliver Carlson',
  'ana': 'Ana',
  'wes': 'Wes Bailey',
  'dani': 'Dani',
  'hugo': 'Hugo',
  'julian': 'Julian',
  'chris': 'Chris Valencia',
  'christian': 'Christian',
};

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

function parseAddress(fromHeader: string): string {
  const angle = fromHeader.match(/<([^>]+)>/);
  return (angle ? angle[1] : fromHeader).toLowerCase().trim();
}

function parseDisplay(fromHeader: string): string | null {
  const m = fromHeader.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/);
  const raw = m ? m[1].trim() : null;
  if (!raw) return null;
  // Strip surrounding quotes if any survived.
  return raw.replace(/^"+|"+$/g, '').trim() || null;
}

function parseName(fromHeader: string) {
  // For sirreel agent addresses, the Gmail header often shows the org
  // alias ("SirReel" or "SirReel Production Vehicles") rather than the
  // actual sender. Prefer the agent-name lookup keyed off the email
  // local-part so the drawer renders the real person.
  const addr = parseAddress(fromHeader);
  if (addr.endsWith('@sirreel.com')) {
    const local = addr.split('@')[0];
    if (local && AGENT_DISPLAY_NAMES[local]) return AGENT_DISPLAY_NAMES[local];
    // Fall through to display-name for unmapped sirreel inboxes.
  }
  const display = parseDisplay(fromHeader);
  if (display) return display;
  return fromHeader.trim();
}

const URGENCY_BADGE: Record<NonNullable<ExtractedMessage['urgency']>, string> = {
  asap: 'bg-red-100 text-red-700',
  normal: 'bg-gray-100 text-gray-600',
  future: 'bg-blue-100 text-blue-700',
};

function QuickReadCard({ extracted }: { extracted: ExtractedMessage }) {
  const c = extracted.contact;
  const j = extracted.jobIntent;
  const hasAnyField =
    c.name || c.email || c.phone || c.title || extracted.company || j.vehicleType ||
    j.pickupDate || j.returnDate || j.duration || j.location || j.projectName ||
    (j.equipment && j.equipment.length > 0) || extracted.rawNotes;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">Quick read</div>
        {extracted.urgency && (
          <span className={`text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded ${URGENCY_BADGE[extracted.urgency]}`}>
            {extracted.urgency}
          </span>
        )}
      </div>
      {extracted.summary && (
        <p className="text-[12px] text-gray-800 leading-snug">{extracted.summary}</p>
      )}
      {hasAnyField && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 pt-1.5 border-t border-amber-200/60">
          <QuickField label="Contact" value={c.name} sub={c.title} />
          <QuickField label="Email" value={c.email} />
          <QuickField label="Phone" value={c.phone} />
          <QuickField label="Company" value={extracted.company} />
          <QuickField label="Vehicle" value={j.vehicleType} />
          <QuickField label="Project" value={j.projectName} />
          <QuickField label="Pickup" value={j.pickupDate} />
          <QuickField label="Return" value={j.returnDate || j.duration} />
          {j.location && <QuickField label="Location" value={j.location} />}
          {j.equipment && j.equipment.length > 0 && (
            <div className="sm:col-span-2">
              <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Equipment</div>
              <div className="text-[11px] text-gray-700">{j.equipment.join(', ')}</div>
            </div>
          )}
          {extracted.rawNotes && (
            <div className="sm:col-span-2">
              <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Notes</div>
              <div className="text-[11px] text-gray-700 leading-snug">{extracted.rawNotes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QuickField({ label, value, sub }: { label: string; value: string | null; sub?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">{label}</div>
      <div className="text-[11px] text-gray-800 truncate">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 truncate">{sub}</div>}
    </div>
  );
}

export function ThreadDrawer({ emailId, onClose, onCapture, onDismiss, busy }: Props) {
  const router = useRouter();
  const [data, setData] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Per-message "View raw email" toggle. Keyed by message id so each
  // message in a multi-message thread can expand independently.
  const [rawOpen, setRawOpen] = useState<Record<string, boolean>>({});
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
  // Header form-type — first inbound message with a detected type wins.
  // Reflects "what kind of thread is this?" prominently above the message list.
  const headerFormType = messages.find((m) =>
    (m.direction === 'inbound' || m.direction === 'INBOUND') && m.inferredFormType,
  )?.inferredFormType ?? null;

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
            <div className="flex items-center gap-2 flex-wrap">
              <div id="thread-drawer-title" className="text-[15px] font-extrabold text-gray-900 truncate">
                {threadSubject}
              </div>
              <FormTypeBadge type={headerFormType} variant="long" />
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
              {messages.map((m) => {
                const inbound = m.direction === 'inbound' || m.direction === 'INBOUND';
                const body = m.bodyText || m.snippet || null;
                const onlySnippet = !m.bodyText && !!m.snippet;
                const extracted = inbound ? m.extractedData : null;
                const confidence = m.extractionConfidence ?? 0;
                // Render the Quick Read card only when the extractor returned
                // something useful. <0.5 confidence → fall back to raw body.
                const showQuickRead = inbound && extracted && confidence >= 0.5;
                const isRawOpen = !!rawOpen[m.id];
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
                        {inbound && <FormTypeBadge type={m.inferredFormType} size="xs" />}
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtWhen(m.sentAt)}</span>
                    </div>
                    {m.toAddresses.length > 0 && (
                      <div className="text-[10px] text-gray-400 mb-1.5 truncate">
                        to {m.toAddresses.join(', ')}
                      </div>
                    )}

                    {showQuickRead ? (
                      <>
                        <QuickReadCard extracted={extracted!} />
                        <button
                          onClick={() => setRawOpen((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                          className="mt-2 text-[10px] font-semibold text-gray-500 hover:text-gray-900"
                        >
                          {isRawOpen ? '▾ Hide raw email' : '▸ View raw email'}
                        </button>
                        {isRawOpen && body && (
                          <p className="mt-2 text-[11px] text-gray-600 whitespace-pre-wrap break-words border-t border-gray-100 pt-2">
                            {body}
                          </p>
                        )}
                      </>
                    ) : inbound && m.extractionRunAt == null ? (
                      <>
                        <div className="text-[10px] text-gray-400 italic mb-1.5">Extracting…</div>
                        {body ? (
                          <p className="text-[12px] text-gray-700 whitespace-pre-wrap break-words">{body}</p>
                        ) : (
                          <p className="text-[12px] text-gray-400 italic">(no preview available)</p>
                        )}
                      </>
                    ) : body ? (
                      <p className="text-[12px] text-gray-700 whitespace-pre-wrap break-words">{body}</p>
                    ) : (
                      <p className="text-[12px] text-gray-400 italic">(no preview available)</p>
                    )}

                    {(onlySnippet || m.attachmentCount > 0) && (
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                        {onlySnippet && <span>snippet only — body not yet synced</span>}
                        {m.attachmentCount > 0 && <span>📎 {m.attachmentCount} attachment{m.attachmentCount === 1 ? '' : 's'}</span>}
                      </div>
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
