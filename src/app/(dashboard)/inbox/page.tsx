'use client';
import { useState, useEffect } from 'react';

const CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  BOOKING_INQUIRY: { label: 'Booking',  icon: '📋', color: 'text-blue-700',   bg: 'bg-blue-50'   },
  COI:             { label: 'COI',       icon: '🛡️', color: 'text-purple-700', bg: 'bg-purple-50' },
  CONTRACT:        { label: 'Contract',  icon: '📄', color: 'text-indigo-700', bg: 'bg-indigo-50' },
  PO:              { label: 'PO',        icon: '📎', color: 'text-cyan-700',   bg: 'bg-cyan-50'   },
  BILLING:         { label: 'Billing',   icon: '💳', color: 'text-amber-700',  bg: 'bg-amber-50'  },
  FLEET_ISSUE:     { label: 'Fleet',     icon: '🔧', color: 'text-red-700',    bg: 'bg-red-50'    },
  FOLLOW_UP:       { label: 'Follow-up', icon: '🔄', color: 'text-orange-700', bg: 'bg-orange-50' },
  GENERAL:         { label: 'General',   icon: '📧', color: 'text-gray-600',   bg: 'bg-gray-50'   },
};

const URGENCY_CONFIG: Record<number, { label: string; color: string; bg: string; border: string }> = {
  0: { label: 'Critical', color: 'text-red-700',    bg: 'bg-red-50',    border: '#f87171' },
  1: { label: 'High',     color: 'text-amber-700',  bg: 'bg-amber-50',  border: '#fbbf24' },
  2: { label: 'Normal',   color: 'text-blue-700',   bg: 'bg-blue-50',   border: '#60a5fa' },
  3: { label: 'Low',      color: 'text-gray-500',   bg: 'bg-gray-50',   border: '#e5e7eb' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (h > 24) return Math.floor(h/24) + 'd ago';
  if (h > 0) return h + 'h ago';
  return m + 'm ago';
}

function fromName(from: string): string {
  return from.replace(/<.*>/, '').trim().replace(/"/g, '') || from;
}

export default function InboxPage() {
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<string>('ALL');
  const [selected, setSelected] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState('');
  const [lastSync, setLastSync] = useState<string>('');

  useEffect(() => {
    try { setCurrentUser(localStorage.getItem('sirreel_demo_name') || ''); } catch {}
    loadEmails();

    // Auto-refresh every 30 seconds
    const interval = setInterval(loadEmails, 30000);
    return () => clearInterval(interval);
  }, []);

  function loadEmails() {
    setLoading(true);
    fetch('/api/gmail/check-replies')
      .then(r => r.json())
      .then(d => {
        const all = d.all || [...(d.urgent || []), ...(d.unassigned || [])];
        setEmails(all);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  async function syncNow() {
    setSyncing(true);
    await fetch('/api/gmail/sync', { method: 'POST' });
    setLastSync(new Date().toLocaleTimeString());
    loadEmails();
    setSyncing(false);
  }

  const isDani = currentUser.includes('Dani') || currentUser.includes('Wes');

  const filtered = emails.filter(e => {
    if (filter === 'ALL') return true;
    if (filter === 'UNREAD') return !e.isRead;
    return e.category === filter;
  });

  const categories = [...new Set(emails.map(e => e.category))];

  return (
    <div className="flex gap-4 h-[calc(100vh-120px)]">
      {/* Left — email list */}
      <div className="w-[420px] flex-shrink-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-[16px] font-bold text-gray-900">📬 Inbox</h1>
            <p className="text-[10px] text-gray-400">
              {isDani ? 'All inboxes · info, jose, oliver, ana' : `${currentUser.split(' ')[0]?.toLowerCase()}@sirreel.com + info@`}
              {lastSync && <span> · synced {lastSync}</span>}
            </p>
          </div>
          <button onClick={syncNow} disabled={syncing}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${syncing ? 'bg-gray-100 text-gray-400' : 'bg-black text-white hover:bg-gray-800'}`}>
            {syncing ? '⏳ Syncing...' : '↻ Sync'}
          </button>
        </div>

        {/* Category filters */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          <button onClick={() => setFilter('ALL')}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${filter === 'ALL' ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            All ({emails.length})
          </button>
          {categories.map(cat => {
            const cfg = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.GENERAL;
            const count = emails.filter(e => e.category === cat).length;
            return (
              <button key={cat} onClick={() => setFilter(filter === cat ? 'ALL' : cat)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${filter === cat ? `${cfg.bg} ${cfg.color} border-current` : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                {cfg.icon} {cfg.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Email list */}
        <div className="flex-1 overflow-y-auto space-y-1.5">
          {loading && (
            <div className="text-center py-12 text-gray-400">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mx-auto mb-2" />
              <div className="text-[12px]">Loading emails...</div>
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <div className="text-4xl mb-2">✅</div>
              <div className="text-[13px] font-medium">All clear</div>
              <div className="text-[11px] mt-1">No emails need attention</div>
              <button onClick={syncNow} className="mt-3 px-4 py-2 rounded-lg bg-black text-white text-[11px] font-bold hover:bg-gray-800">
                Sync now
              </button>
            </div>
          )}

          {filtered.map(e => {
            const urgCfg = URGENCY_CONFIG[e.priority] || URGENCY_CONFIG[2];
            const catCfg = CATEGORY_CONFIG[e.category] || CATEGORY_CONFIG.GENERAL;
            const isSelected = selected?.id === e.id;
            return (
              <div key={e.id} onClick={() => setSelected(isSelected ? null : e)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'ring-2 ring-black' : 'hover:shadow-sm'}`}
                style={{ borderLeftWidth: 3, borderLeftColor: urgCfg.border }}>
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[12px] font-bold text-gray-900 truncate flex-1 mr-2">{fromName(e.fromAddress)}</span>
                  <span className="text-[9px] text-gray-400 flex-shrink-0">{timeAgo(e.sentAt)}</span>
                </div>
                <div className="text-[11px] text-gray-700 font-medium truncate mb-1">{e.subject}</div>
                <div className="text-[10px] text-gray-400 truncate mb-1.5">{e.snippet}</div>
                <div className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${catCfg.color} ${catCfg.bg}`}>
                    {catCfg.icon} {catCfg.label}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${urgCfg.color} ${urgCfg.bg}`}>
                    {urgCfg.label}
                  </span>
                  {!e.isRead && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right — detail panel */}
      <div className="flex-1 bg-white rounded-xl border border-gray-200 flex flex-col">
        {!selected && (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <div className="text-5xl mb-3">📧</div>
            <div className="text-[14px] font-medium">Select an email to view</div>
            {isDani && (
              <div className="mt-6 p-4 rounded-xl bg-amber-50 border border-amber-200 max-w-sm text-center">
                <div className="text-[12px] font-bold text-amber-700 mb-1">Dani — Response Tracker</div>
                <div className="text-[11px] text-amber-600">
                  {emails.filter(e => e.priority <= 1).length} emails need urgent replies.<br />
                  {emails.filter(e => e.priority === 0).length} are critical.
                </div>
              </div>
            )}
          </div>
        )}

        {selected && (
          <>
            <div className="p-5 border-b border-gray-100">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0 mr-3">
                  <h2 className="text-[15px] font-bold text-gray-900 mb-1">{selected.subject}</h2>
                  <div className="text-[12px] text-gray-500">{selected.fromAddress}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{new Date(selected.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(() => {
                  const catCfg = CATEGORY_CONFIG[selected.category] || CATEGORY_CONFIG.GENERAL;
                  const urgCfg = URGENCY_CONFIG[selected.priority] || URGENCY_CONFIG[2];
                  return (
                    <>
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${catCfg.color} ${catCfg.bg}`}>{catCfg.icon} {catCfg.label}</span>
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${urgCfg.color} ${urgCfg.bg}`}>{urgCfg.label}</span>
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 text-[13px] text-gray-700 leading-relaxed mb-4">
                {selected.snippet}
                <div className="text-[10px] text-gray-400 mt-2 italic">Preview only — open in Gmail to see full email</div>
              </div>

              {/* Action buttons */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Actions</div>
                <a href={`https://mail.google.com/mail/u/0/#inbox/${selected.threadId || ''}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 p-3 rounded-lg bg-black text-white text-[12px] font-bold hover:bg-gray-800 transition-colors">
                  <span>↗</span> Open in Gmail & Reply
                </a>
                {selected.category === 'BOOKING_INQUIRY' && (
                  <a href="/bookings" className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-[12px] font-semibold hover:bg-blue-100">
                    <span>📋</span> Create booking in Jobs
                  </a>
                )}
                {selected.category === 'COI' && (
                  <a href="/claims" className="flex items-center gap-2 p-3 rounded-lg bg-purple-50 border border-purple-200 text-purple-700 text-[12px] font-semibold hover:bg-purple-100">
                    <span>🛡️</span> Log COI in Claims
                  </a>
                )}
                {isDani && (
                  <button className="w-full flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-[12px] font-semibold hover:bg-amber-100">
                    <span>👋</span> Nudge assigned agent
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
