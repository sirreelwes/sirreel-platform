'use client';
import EmailActionPanel from "@/components/inbox/EmailActionPanel";
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

const CAT: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  BOOKING_INQUIRY: { label: 'New Booking',  icon: '📋', color: 'text-cadence-booked-fg',   bg: 'bg-cadence-booked-bg',   border: 'border-cadence-booked-fg/30' },
  COI:             { label: 'COI',          icon: '🛡️', color: 'text-cadence-returned-fg', bg: 'bg-cadence-returned-bg', border: 'border-cadence-returned-fg/30' },
  CONTRACT:        { label: 'Contract',     icon: '📄', color: 'text-cadence-picking-today-fg', bg: 'bg-cadence-picking-today-bg', border: 'border-cadence-picking-today-fg/30' },
  PO:              { label: 'PO',           icon: '📎', color: 'text-cadence-invoiced-fg',   bg: 'bg-cadence-invoiced-bg',   border: 'border-cadence-invoiced-fg/30' },
  BILLING:         { label: 'Billing',      icon: '💳', color: 'text-chip-warn-fg',  bg: 'bg-chip-warn-bg',  border: 'border-chip-warn-fg/30' },
  FLEET_ISSUE:     { label: 'Fleet Issue',  icon: '🔧', color: 'text-chip-bad-fg',    bg: 'bg-chip-bad-bg',    border: 'border-chip-bad-fg/30' },
  FOLLOW_UP:       { label: 'Follow-up',   icon: '🔄', color: 'text-cadence-returning-today-fg', bg: 'bg-cadence-returning-today-bg', border: 'border-cadence-returning-today-fg/30' },
  COMPLAINT:       { label: 'Complaint',    icon: '⚠️', color: 'text-chip-bad-fg',    bg: 'bg-chip-bad-bg',    border: 'border-chip-bad-fg/30' },
  SUPPORT:         { label: 'Support',      icon: '🙋', color: 'text-cadence-on-rental-fg',   bg: 'bg-cadence-on-rental-bg',   border: 'border-cadence-on-rental-fg/30' },
  GENERAL:         { label: 'General',      icon: '📧', color: 'text-chip-neutral-fg',   bg: 'bg-chip-neutral-bg',   border: 'border-chip-neutral-fg/30' },
};

const URGENCY = [
  { level: 0, label: 'Critical', dot: 'bg-chip-bad-fg',    header: 'bg-chip-bad-bg border-chip-bad-fg/30 text-chip-bad-fg' },
  { level: 1, label: 'High',     dot: 'bg-cadence-returning-today-bar',  header: 'bg-chip-warn-bg border-chip-warn-fg/30 text-chip-warn-fg' },
  { level: 2, label: 'Normal',   dot: 'bg-cadence-booked-bar',   header: 'bg-cadence-booked-bg border-cadence-booked-fg/30 text-cadence-booked-fg' },
  { level: 3, label: 'Low',      dot: 'bg-chip-neutral-fg',   header: 'bg-chip-neutral-bg border-chip-neutral-fg/30 text-chip-neutral-fg' },
];

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const h = Math.floor(diff / 3600000), m = Math.floor(diff / 60000);
  if (h > 24) return Math.floor(h/24) + 'd';
  if (h > 0) return h + 'h';
  return m + 'm';
}

function fromName(from: string) {
  return from.replace(/<.*>/, '').trim().replace(/"/g, '') || from;
}

// Deduplicate by threadId, keeping latest message per thread
function dedupeByThread(emails: any[]) {
  const threads = new Map<string, any>();
  for (const e of emails) {
    const key = e.threadId || e.gmailMessageId || e.id;
    const existing = threads.get(key);
    if (!existing || new Date(e.sentAt) > new Date(existing.sentAt)) {
      threads.set(key, e);
    }
  }
  return Array.from(threads.values());
}

export default function InboxPage() {
  const { data: session } = useSession();
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [replyFilter, setReplyFilter] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [lastSync, setLastSync] = useState('');

  const userEmail = (session?.user as any)?.email || '';
  const userRole = (session?.user as any)?.role || 'AGENT';
  const isAdmin = userRole === 'ADMIN';
  const firstName = session?.user?.name?.split(' ')[0] || '';

  useEffect(() => {
    loadEmails();
    const t = setInterval(loadEmails, 30000);
    return () => clearInterval(t);
  }, []);

  function loadEmails() {
    setLoading(true);
    fetch('/api/gmail/check-replies')
      .then(r => r.json())
      .then(d => {
        let all = d.all || [];
        all = dedupeByThread(all);
        // Role-based filter: agents see only their inbox + info@
        // Only filter if we have confirmed role from session
        if (false && userRole === "AGENT" && userEmail) {
          all = all.filter((e: any) => {
            const to = (e.toAddresses || []).join(' ').toLowerCase();
            return to.includes('info@sirreel') || to.includes(userEmail.toLowerCase());
          });
        }
        setEmails(all);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  async function syncNow() {
    setSyncing(true);
    await fetch('/api/gmail/sync', { method: 'POST' });
    setLastSync(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    loadEmails();
    setSyncing(false);
  }

  const filtered = emails.filter(e => {
    if (replyFilter && !e.needsReply) return false;
    if (catFilter !== 'ALL' && e.category !== catFilter) return false;
    return true;
  });

  const needsReplyCount = emails.filter(e => e.needsReply).length;
  const usedCats = [...new Set(emails.map(e => e.category))].filter(Boolean);

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="flex gap-4 h-[calc(100vh-180px)]">

      {/* LEFT — list */}
      <div className="w-[400px] flex-shrink-0 flex flex-col gap-3">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[16px] font-bold text-lt-fg">Inbox</h1>
            <p className="text-[10px] text-lt-fg3">
              {isAdmin ? 'All inboxes' : `${firstName?.toLowerCase()}@ + info@`}
              {lastSync && <span> · synced {lastSync}</span>}
            </p>
          </div>
          <button onClick={syncNow} disabled={syncing}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-lt-fg text-white hover:bg-black disabled:opacity-40">
            {syncing ? '⏳' : '↻'} Sync
          </button>
        </div>

        {/* Needs Reply toggle */}
        <button onClick={() => setReplyFilter(v => !v)}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border font-semibold transition-all ${replyFilter ? 'bg-chip-bad-fg text-white border-chip-bad-fg' : needsReplyCount > 0 ? 'bg-chip-bad-bg text-chip-bad-fg border-chip-bad-fg/30 hover:opacity-90' : 'bg-lt-inner text-lt-fg3 border-lt-hairline'}`}>
          <div className="flex items-center gap-2">
            <span className="text-base">↩</span>
            <span className="text-[13px]">Needs Reply</span>
          </div>
          <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full ${replyFilter ? 'bg-lt-card/20 text-lt-fg' : needsReplyCount > 0 ? 'bg-chip-bad-bg text-chip-bad-fg' : 'bg-lt-inner text-lt-fg3'}`}>
            {needsReplyCount}
          </span>
        </button>

        {/* Category pills */}
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setCatFilter('ALL')}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${catFilter === 'ALL' ? 'bg-lt-fg text-white border-lt-fg' : 'bg-lt-card text-lt-fg3 border-lt-hairline hover:border-lt-fg2'}`}>
            All ({emails.length})
          </button>
          {usedCats.map(cat => {
            const cfg = CAT[cat] || CAT.GENERAL;
            const count = emails.filter(e => e.category === cat).length;
            return (
              <button key={cat} onClick={() => setCatFilter(catFilter === cat ? 'ALL' : cat)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${catFilter === cat ? `${cfg.bg} ${cfg.color} ${cfg.border}` : 'bg-lt-card text-lt-fg3 border-lt-hairline hover:border-lt-fg2'}`}>
                {cfg.icon} {cfg.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Email list by urgency */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {loading ? (
            <div className="text-center py-12 text-lt-fg3 text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-lt-fg3 text-sm">No emails{replyFilter ? ' needing reply' : ''}</div>
          ) : (
            URGENCY.map(urg => {
              const group = filtered.filter(e => (e.priority ?? 2) === urg.level);
              if (!group.length) return null;
              return (
                <div key={urg.level}>
                  {/* Urgency header */}
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border mb-2 ${urg.header}`}>
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${urg.dot}`} />
                    <span className="text-[11px] font-bold uppercase tracking-wider">{urg.label}</span>
                    <span className="text-[11px] font-bold ml-auto">{group.length}</span>
                  </div>
                  <div className="space-y-1.5 pl-1">
                    {group.map(e => {
                      const cat = CAT[e.category] || CAT.GENERAL;
                      const isSelected = selected?.id === e.id;
                      return (
                        <div key={e.id} onClick={() => setSelected(isSelected ? null : e)}
                          className={`p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'ring-2 ring-lt-fg bg-lt-card' : 'bg-lt-card hover:shadow-sm border-lt-hairline'}`}>
                          {/* Category badge — prominent */}
                          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold mb-2 ${cat.bg} ${cat.color} ${cat.border} border`}>
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                          </div>
                          {/* Sender + time */}
                          <div className="flex items-start justify-between gap-2 mb-0.5">
                            <span className="text-[13px] font-bold text-lt-fg truncate flex-1">{fromName(e.fromAddress)}</span>
                            <span className="text-[10px] text-lt-fg3 flex-shrink-0">{timeAgo(e.sentAt)}</span>
                          </div>
                          {/* Subject */}
                          <div className="text-[11px] text-lt-fg2 font-medium truncate mb-1">{e.subject}</div>
                          {/* Snippet */}
                          <div className="text-[10px] text-lt-fg3 truncate">{e.snippet}</div>
                          {/* Tags */}
                          <div className="flex items-center gap-1.5 mt-2">
                            {e.needsReply && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold bg-chip-bad-bg text-chip-bad-fg`}>
                                ↩ Reply needed
                              </span>
                            )}
                            {e.needsReply && e.waitHours >= 1 && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${e.urgencyFromWait <= 1 ? 'bg-chip-bad-bg text-chip-bad-fg' : 'bg-chip-warn-bg text-chip-warn-fg'}`}>
                                {e.waitLabel}
                              </span>
                            )}
                            {!e.isRead && <span className="w-2 h-2 rounded-full bg-cadence-booked-bar flex-shrink-0" />}
                            {e.toAddress && (
                              <span className="text-[9px] text-lt-fg3 truncate">
                                → {e.toAddress.split('@')[0]}@
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT — detail panel */}
      <div className="flex-1 bg-lt-card rounded-xl border border-lt-hairline flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-lt-fg3">
            <div className="text-4xl mb-3">📬</div>
            <div className="text-sm font-semibold">Select an email to view</div>
            <div className="text-[11px] mt-1">{filtered.length} thread{filtered.length !== 1 ? 's' : ''} shown</div>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 border-b border-lt-hairline">
              {(() => {
                const cat = CAT[selected.category] || CAT.GENERAL;
                const urg = URGENCY.find(u => u.level === (selected.priority ?? 2)) || URGENCY[2];
                return (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${cat.bg} ${cat.color} ${cat.border}`}>
                        {cat.icon} {cat.label}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${urg.header}`}>
                        <div className={`w-2 h-2 rounded-full ${urg.dot}`} />
                        {urg.label}
                      </span>
                      {selected.needsReply && (
                        <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-chip-bad-bg text-chip-bad-fg border border-chip-bad-fg/30">
                          ↩ Reply needed {selected.waitLabel && `· ${selected.waitLabel}`}
                        </span>
                      )}
                    </div>
                    <h2 className="text-[15px] font-bold text-lt-fg">{selected.subject}</h2>
                    <div className="text-[12px] text-lt-fg3">{selected.fromAddress}</div>
                    <div className="text-[10px] text-lt-fg3">
                      {new Date(selected.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {selected.toAddress && <span> · to {selected.toAddress}</span>}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Snippet */}
              <div className="text-[13px] text-lt-fg2 leading-relaxed bg-lt-inner rounded-xl p-4">
                {selected.snippet}
              </div>

              {/* AI Action Panel */}
              <EmailActionPanel email={selected} />

              {/* Open in Gmail */}
              <div className="pt-2 border-t border-lt-hairline space-y-2">
                <a href={`https://mail.google.com/mail/u/0/#inbox/${selected.threadId || ''}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-2.5 bg-lt-fg text-white rounded-xl text-[12px] font-bold hover:bg-black">
                  ↗ Open Full Thread in Gmail
                </a>
              </div>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
