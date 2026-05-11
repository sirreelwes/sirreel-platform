'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { NewInquiryModal } from './NewInquiryModal';
import { ThreadDrawer } from './ThreadDrawer';

// The Inquiries section is intentionally a "blank slate" between sessions.
// It surfaces inbound emails that look like inquiry candidates (BOOKING_INQUIRY
// or RENTAL_REQUEST) and never displays a persistent backlog of NEW inquiries.
// Capturing or dismissing a suggestion records the decision against the
// underlying email so it stops surfacing.

interface SuggestionRecord {
  emailId: string;
  fromAddress: string;
  subject: string;
  snippet: string | null;
  sentAt: string;
  category: 'BOOKING_INQUIRY' | 'RENTAL_REQUEST' | null;
  company: { id: string; name: string } | null;
  person: { id: string; firstName: string; lastName: string; email: string } | null;
}

const CATEGORY_BADGE: Record<NonNullable<SuggestionRecord['category']>, string> = {
  BOOKING_INQUIRY: 'bg-emerald-900/40 text-emerald-300',
  RENTAL_REQUEST: 'bg-blue-900/40 text-blue-300',
};

function ageString(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function InquiriesSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [suggestions, setSuggestions] = useState<SuggestionRecord[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawerEmailId, setDrawerEmailId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/sales/suggested-inquiries')
      .then((r) => r.json())
      .then((d) => setSuggestions(d.suggestions || []))
      .catch(() => setSuggestions([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Deep-link: open the drawer if ?thread=<emailId> is in the URL.
  useEffect(() => {
    const t = searchParams?.get('thread') || null;
    setDrawerEmailId(t);
  }, [searchParams]);

  const openDrawer = useCallback((emailId: string) => {
    setDrawerEmailId(emailId);
    const params = new URLSearchParams(Array.from(searchParams?.entries() || []));
    params.set('thread', emailId);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const closeDrawer = useCallback(() => {
    setDrawerEmailId(null);
    const params = new URLSearchParams(Array.from(searchParams?.entries() || []));
    params.delete('thread');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [router, searchParams]);

  // Returns true when navigation was kicked off (Inquiry created and
  // router.push fired). Callers that need to chase state mutations
  // *only* on failure can branch on the return value — chasing on
  // success would race the navigation and cancel it. That's exactly
  // the drawer-vs-card bug we saw: the drawer wrapper was calling
  // closeDrawer() unconditionally, which router.replace'd over the
  // pending push.
  const capture = async (emailId: string): Promise<boolean> => {
    setBusyId(emailId);
    try {
      let res: Response;
      try {
        res = await fetch('/api/sales/suggested-inquiries/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailId }),
        });
      } catch (err) {
        console.error('[capture] network error:', err);
        alert(`Failed to capture: ${err instanceof Error ? err.message : 'network error'}`);
        return false;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || `Failed to capture (HTTP ${res.status})`);
        return false;
      }
      const data = await res.json();
      const inquiryId = data.inquiry?.id;
      if (inquiryId) {
        router.push(`/orders/new-quote?inquiryId=${encodeURIComponent(inquiryId)}`);
        return true;
      }
      load();
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (emailId: string) => {
    setBusyId(emailId);
    try {
      await fetch('/api/sales/suggested-inquiries/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailId }),
      });
      load();
    } finally {
      setBusyId(null);
    }
  };

  const onManualCreated = (inquiryId: string | null) => {
    if (inquiryId) {
      router.push(`/orders/new-quote?inquiryId=${encodeURIComponent(inquiryId)}`);
    } else {
      load();
    }
  };

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-white">Inquiries</h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Suggestions from your inbox. Capture turns a lead into a quote — or dismiss what isn&apos;t one.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[12px] font-bold rounded-lg"
        >
          + New Inquiry
        </button>
      </div>

      {suggestions === null ? (
        <div className="text-xs text-zinc-600 text-center py-6">Loading…</div>
      ) : suggestions.length === 0 ? (
        <div className="text-xs text-zinc-600 text-center py-6">
          Inbox is clear — no suggested inquiries. Capture a manual one to get started.
        </div>
      ) : (
        <div className="divide-y divide-zinc-800">
          {suggestions.map((s) => {
            const fromName = s.person
              ? `${s.person.firstName} ${s.person.lastName}`
              : s.fromAddress;
            const busy = busyId === s.emailId;
            return (
              <div key={s.emailId} className="py-2.5 flex items-start justify-between gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => openDrawer(s.emailId)}
                  className="min-w-0 flex-1 space-y-1 text-left rounded hover:bg-zinc-800/40 -mx-1 px-1 py-0.5 transition-colors"
                  aria-label={`Preview thread: ${s.subject || 'no subject'}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white truncate">{s.subject || '(no subject)'}</span>
                    {s.category && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${CATEGORY_BADGE[s.category]}`}>
                        {s.category.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500 flex-wrap">
                    <span>{fromName}</span>
                    {s.company && <span>· {s.company.name}</span>}
                    <span>· {ageString(s.sentAt)} ago</span>
                  </div>
                  {s.snippet && (
                    <p className="text-[11px] text-zinc-400 line-clamp-2">{s.snippet}</p>
                  )}
                </button>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); capture(s.emailId); }}
                    disabled={busy}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white text-[11px] font-bold rounded"
                  >
                    {busy ? 'Capturing…' : 'Capture & Quote'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); dismiss(s.emailId); }}
                    disabled={busy}
                    className="px-2.5 py-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-50 text-[11px] font-semibold"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewInquiryModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(id) => { setShowNew(false); onManualCreated(id); }}
      />

      <ThreadDrawer
        emailId={drawerEmailId}
        onClose={closeDrawer}
        // On capture success the router.push to /orders/new-quote
        // already unmounts the drawer; only close manually on a
        // failure (capture returns false) so the user can retry.
        // Calling closeDrawer() unconditionally was racing the push
        // and cancelling the navigation.
        onCapture={async (id) => {
          const navigated = await capture(id);
          if (!navigated) closeDrawer();
        }}
        onDismiss={async (id) => { await dismiss(id); closeDrawer(); }}
        busy={busyId !== null && busyId === drawerEmailId}
      />
    </section>
  );
}
