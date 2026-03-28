'use client';
import EmailActionPanel from "@/components/inbox/EmailActionPanel";
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

const CAT: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  BOOKING_INQUIRY: { label: 'New Booking',  icon: '📋', color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  COI:             { label: 'COI',          icon: '🛡️', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
  CONTRACT:        { label: 'Contract',     icon: '📄', color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
  PO:              { label: 'PO',           icon: '📎', color: 'text-cyan-700',   bg: 'bg-cyan-50',   border: 'border-cyan-200' },
  BILLING:         { label: 'Billing',      icon: '💳', color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200' },
  FLEET_ISSUE:     { label: 'Fleet Issue',  icon: '🔧', color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200' },
  FOLLOW_UP:       { label: 'Follow-up',   icon: '🔄', color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
  COMPLAINT:       { label: 'Complaint',    icon: '⚠️', color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200' },
  SUPPORT:         { label: 'Support',      icon: '🙋', color: 'text-teal-700',   bg: 'bg-teal-50',   border: 'border-teal-200' },
  GENERAL:         { label: 'General',      icon: '📧', color: 'text-gray-600',   bg: 'bg-gray-50',   border: 'border-gray-200' },
};

const URGENCY = [
  { level: 0, label: 'Critical', dot: 'bg-red-500',    header: 'bg-red-50 border-red-200 text-red-700' },
  { level: 1, label: 'High',     dot: 'bg-amber-400',  header: 'bg-amber-50 border-amber-200 text-amber-700' },
  { level: 2, label: 'Normal',   dot: 'bg-blue-400',   header: 'bg-blue-50 border-blue-200 text-blue-600' },
  { level: 3, label: 'Low',      dot: 'bg-gray-300',   header: 'bg-gray-50 border-gray-200 text-gray-500' },
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
    <div className="flex gap-4 h-[calc(100vh-120px)]">

      {/* LEFT — list */}
      <div className="w-[400px] flex-shrink-0 flex flex-col gap-3">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[16px] font-bold text-gray-900">Inbox</h1>
            <p className="text-[10px] text-gray-400">
              {isAdmin ? 'All inboxes' : `${firstName?.toLowerCase()}@ + info@`}
              {lastSync && <span> · synced {lastSync}</span>}
            </p>
          </div>
          <button onClick={syncNow} disabled={syncing}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40">
            {syncing ? '⏳' : '↻'} Sync
          </button>
        </div>

        {/* Needs Reply toggle */}
        <button onClick={() => setReplyFilter(v => !v)}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border font-semibold transition-all ${replyFilter ? 'bg-red-600 text-white border-red-600' : needsReplyCount > 0 ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <span className="text-base">↩</span>
            <span className="text-[13px]">Needs Reply</span>
          </div>
          <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full ${replyFilter ? 'bg-white/20 text-white' : needsReplyCount > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400'}`}>
            {needsReplyCount}
          </span>
        </button>

        {/* Category pills */}
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setCatFilter('ALL')}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${catFilter === 'ALL' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
            All ({emails.length})
          </button>
          {usedCats.map(cat => {
            const cfg = CAT[cat] || CAT.GENERAL;
            const count = emails.filter(e => e.category === cat).length;
            return (
              <button key={cat} onClick={() => setCatFilter(catFilter === cat ? 'ALL' : cat)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${catFilter === cat ? `${cfg.bg} ${cfg.color} ${cfg.border}` : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                {cfg.icon} {cfg.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Email list by urgency */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No emails{replyFilter ? ' needing reply' : ''}</div>
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
                          className={`p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'ring-2 ring-gray-900 bg-white' : 'bg-white hover:shadow-sm border-gray-100'}`}>
                          {/* Category badge — prominent */}
                          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold mb-2 ${cat.bg} ${cat.color} ${cat.border} border`}>
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                          </div>
                          {/* Sender + time */}
                          <div className="flex items-start justify-between gap-2 mb-0.5">
                            <span className="text-[13px] font-bold text-gray-900 truncate flex-1">{fromName(e.fromAddress)}</span>
                            <span className="text-[10px] text-gray-400 flex-shrink-0">{timeAgo(e.sentAt)}</span>
                          </div>
                          {/* Subject */}
                          <div className="text-[11px] text-gray-600 font-medium truncate mb-1">{e.subject}</div>
                          {/* Snippet */}
                          <div className="text-[10px] text-gray-400 truncate">{e.snippet}</div>
                          {/* Tags */}
                          <div className="flex items-center gap-1.5 mt-2">
                            {e.needsReply && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-700`}>
                                ↩ Reply needed
                              </span>
                            )}
                            {e.needsReply && e.waitHours >= 1 && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${e.urgencyFromWait <= 1 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                {e.waitLabel}
                              </span>
                            )}
                            {!e.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
                            {e.toAddress && (
                              <span className="text-[9px] text-gray-300 truncate">
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
      <div className="flex-1 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <div className="text-4xl mb-3">📬</div>
            <div className="text-sm font-semibold">Select an email to view</div>
            <div className="text-[11px] mt-1">{filtered.length} thread{filtered.length !== 1 ? 's' : ''} shown</div>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 border-b border-gray-100">
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
                        <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-red-100 text-red-700 border border-red-200">
                          ↩ Reply needed {selected.waitLabel && `· ${selected.waitLabel}`}
                        </span>
                      )}
                    </div>
                    <h2 className="text-[15px] font-bold text-gray-900">{selected.subject}</h2>
                    <div className="text-[12px] text-gray-500">{selected.fromAddress}</div>
                    <div className="text-[10px] text-gray-400">
                      {new Date(selected.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {selected.toAddress && <span> · to {selected.toAddress}</span>}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Snippet */}
              <div className="text-[13px] text-gray-700 leading-relaxed bg-gray-50 rounded-xl p-4">
                {selected.snippet}
              </div>

              {/* AI Action Panel */}
              <EmailActionPanel email={selected} />

              {/* Open in Gmail */}
              <div className="pt-2 border-t border-gray-100 space-y-2">
                <a href={`https://mail.google.com/mail/u/0/#inbox/${selected.threadId || ''}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-2.5 bg-gray-900 text-white rounded-xl text-[12px] font-bold hover:bg-gray-700">
                  ↗ Open Full Thread in Gmail
                </a>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
