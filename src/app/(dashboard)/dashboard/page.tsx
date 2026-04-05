'use client';

import { useState, useEffect } from 'react';
import { UserRole } from '@prisma/client';
import SalesDashboard from '@/components/dashboard/SalesDashboard';
import ReviewsWidget from "@/components/dashboard/ReviewsWidget";
import CollectionsDashboard from '@/components/dashboard/CollectionsDashboard';
import CollectionsReportWidget from '@/components/dashboard/CollectionsReportWidget';
import DaniDashboard from '@/components/dashboard/DaniDashboard';

const ADMIN_DASHBOARD_USERS = ['Wes', 'Dani Novoa'];
const SALES_USERS = ['Jose Pacheco', 'Oliver Carlson'];
const COLLECTIONS_USERS = ['Ana DeAngelis'];

const nowHour = new Date().getHours();
const greeting = nowHour < 12 ? 'Good morning' : nowHour < 17 ? 'Good afternoon' : 'Good evening';

export default function DashboardPage() {
  const [currentUserName, setCurrentUserName] = useState('');
  const [currentRole, setCurrentRole] = useState<UserRole>(UserRole.ADMIN);

  useEffect(() => {
    try {
      const name = localStorage.getItem('sirreel_demo_name') || '';
      const role = localStorage.getItem('sirreel_demo_role') as UserRole || UserRole.ADMIN;
      setCurrentUserName(name);
      setCurrentRole(role);
    } catch {}

    const handler = () => {
      try {
        const name = localStorage.getItem('sirreel_demo_name') || '';
        const role = localStorage.getItem('sirreel_demo_role') as UserRole || UserRole.ADMIN;
        setCurrentUserName(name);
        setCurrentRole(role);
      } catch {}
    };
    window.addEventListener('sirreel_role_change', handler);
    return () => window.removeEventListener('sirreel_role_change', handler);
  }, []);

  if (COLLECTIONS_USERS.some(u => currentUserName.includes(u.split(' ')[0]))) {
    return <CollectionsDashboard />;
  }

  if (SALES_USERS.some(u => currentUserName.includes(u.split(' ')[0]))) {
    return <SalesDashboard agentName={currentUserName || 'Jose'} />;
  }

  if (currentUserName.includes('Dani')) {
    return <DaniDashboard userName={currentUserName || 'Dani'} />;
  }
  return <AdminDashboard userName={currentUserName || 'Wes'} />;
}

const CATEGORY_CFG: Record<string, { label: string; color: string; bg: string }> = {
  BOOKING_INQUIRY: { label: 'Booking', color: 'text-blue-700', bg: 'bg-blue-50' },
  BILLING:         { label: 'Billing', color: 'text-amber-700', bg: 'bg-amber-50' },
  COMPLAINT:       { label: 'Complaint', color: 'text-red-700', bg: 'bg-red-50' },
  FLEET_ISSUE:     { label: 'Fleet', color: 'text-red-700', bg: 'bg-red-50' },
  GENERAL:         { label: 'General', color: 'text-gray-600', bg: 'bg-gray-50' },
  SUPPORT:         { label: 'Support', color: 'text-purple-700', bg: 'bg-purple-50' },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function AdminDashboard({ userName }: { userName: string }) {
  const [showAllFleet, setShowAllFleet] = useState(false);
  const [rwOrders, setRwOrders] = useState<any[]>([]);
  const [rwConnected, setRwConnected] = useState(false);
  const [emails, setEmails] = useState<any[]>([]);
  const [planyoUnits, setPlanyoUnits] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [emailLoading, setEmailLoading] = useState(true);

  // Count units booked today from Planyo
  const todayStr = new Date().toISOString().slice(0, 10);
  const countOut = (cat: string) => planyoUnits.filter(u =>
    u.cat === cat && u.bookings?.some((b: any) => b.start <= todayStr && b.end >= todayStr)
  ).length;

  const FLEET = [
    { cat: 'Cube Truck', short: 'Cube', total: 41, out: planyoUnits.length ? countOut('cube') : 19, maint: 4, rate: 175, color: '#3b82f6', icon: '🚛' },
    { cat: 'Cargo Van w/ LG', short: 'Cargo', total: 30, out: planyoUnits.length ? countOut('cargo') : 14, maint: 4, rate: 200, color: '#8b5cf6', icon: '🚐' },
    { cat: 'Cargo Van w/o LG', short: 'Cargo (no LG)', total: 8, out: planyoUnits.length ? countOut('cargo') : 3, maint: 0, rate: 150, color: '#a78bfa', icon: '🚐' },
    { cat: 'Passenger Van', short: 'Pass Van', total: 10, out: planyoUnits.length ? countOut('pass') : 4, maint: 1, rate: 175, color: '#06b6d4', icon: '🚌' },
    { cat: 'PopVan', short: 'PopVan', total: 9, out: planyoUnits.length ? countOut('pop') : 3, maint: 2, rate: 400, color: '#f59e0b', icon: '🎬' },
    { cat: 'Camera Cube', short: 'Cam Cube', total: 7, out: planyoUnits.length ? countOut('cam') : 2, maint: 0, rate: 200, color: '#ec4899', icon: '📷' },
    { cat: 'DLUX', short: 'DLUX', total: 8, out: planyoUnits.length ? countOut('dlux') : 4, maint: 0, rate: 450, color: '#10b981', icon: '✨' },
    { cat: 'ProScout/VTR', short: 'Scout', total: 3, out: planyoUnits.length ? countOut('scout') : 1, maint: 0, rate: 450, color: '#f97316', icon: '📡' },
    { cat: 'Studios', short: 'Studios', total: 10, out: planyoUnits.length ? countOut('studio') : 4, maint: 0, rate: 3000, color: '#6366f1', icon: '🏢' },
  ];
  const totalUnits = FLEET.reduce((s, f) => s + f.total, 0);
  const totalOut = FLEET.reduce((s, f) => s + f.out, 0);
  const totalMaint = FLEET.reduce((s, f) => s + f.maint, 0);
  const totalAvail = totalUnits - totalOut - totalMaint;

  useEffect(() => {
    // Seed recurring alerts then fetch
    fetch('/api/alerts/seed').catch(() => {})
    const fetchAlerts = () => {
      const email = userName.toLowerCase().includes('dani') ? 'dani@sirreel.com' : 'wes@sirreel.com'
      fetch(`/api/alerts?user=${encodeURIComponent(email)}`)
        .then(r => r.json())
        .then(d => { if (d.ok) setAlerts(d.alerts || []) })
        .catch(() => {})
    }
    fetchAlerts()
  }, []);

  useEffect(() => {
    fetch('/api/timeline')
      .then(r => r.json())
      .then(d => { if (d.ok) setPlanyoUnits(d.units || []) })
      .catch(() => {})
  }, []);

  useEffect(() => {
    fetch('/api/rentalworks').then(r => r.json()).then(data => {
      if (data?.orders?.Rows) {
        const cols = data.orders.ColumnIndex;
        const rows = data.orders.Rows.map((r: any[]) => ({
          orderId:     r[cols.OrderId],
          orderNumber: r[cols.OrderNumber],
          description: r[cols.Description],
          customer:    r[cols.Customer],
          agent:       (r[cols.CustomerServiceRepresentative] || '').split(',').reverse().join(' ').trim(),
          status:      r[cols.Status],
          total:       Number(r[cols.Total]) || 0,
          startDate:   r[cols.EstimatedStartDate] || '',
          endDate:     r[cols.EstimatedStopDate] || '',
        }));
        setRwOrders(rows);
        setRwConnected(true);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/gmail/check-replies')
      .then(r => r.json())
      .then(data => {
        if (data.ok) setEmails(data.all || []);
      })
      .catch(() => {})
      .finally(() => setEmailLoading(false));
  }, []);

  const activeJobs = rwOrders.filter(o => ['ACTIVE','CONFIRMED'].includes(o.status));

  // Real KPIs from RentalWorks
  const thisMonth = new Date().toISOString().slice(0, 7); // "2026-03"
  const revenueMTD = rwOrders
    .filter(o => ['ACTIVE','COMPLETE','CLOSED'].includes(o.status) && (o.startDate || '').startsWith(thisMonth))
    .reduce((s, o) => s + (o.total || 0), 0);
  const outstanding = rwOrders
    .filter(o => ['CONFIRMED','ACTIVE'].includes(o.status))
    .reduce((s, o) => s + (o.total || 0), 0);
  const fmtK = (n: number) => n >= 1000 ? `$${(n/1000).toFixed(1)}K` : `$${n}`;
  const displayFleet = showAllFleet ? FLEET : FLEET.filter(f => f.out > 0 || f.maint > 0);

  const urgentEmails = emails.filter(e => e.priority <= 1);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [dismissedEmails, setDismissedEmails] = useState<Set<string>>(new Set());
  const unreadEmails = emails.filter(e => !e.isRead);

  // Build team response alerts from live email data
  const AGENT_INBOX: Record<string, string> = {
    'jose@sirreel.com': 'Jose',
    'oliver@sirreel.com': 'Oliver',
    'info@sirreel.com': 'Info',
    'ana@sirreel.com': 'Ana',
  };

  const agentAlerts = (() => {
    const unanswered = emails.filter(e => e.needsReply);
    const byAgent: Record<string, { count: number; maxWait: number; oldest: any }> = {};
    
    unanswered.forEach((e: any) => {
      const inbox = (e.toAddresses || [])[0] || '';
      const agent = AGENT_INBOX[inbox] || inbox.split('@')[0];
      if (!byAgent[agent]) byAgent[agent] = { count: 0, maxWait: 0, oldest: e };
      byAgent[agent].count++;
      if (e.waitHours > byAgent[agent].maxWait) {
        byAgent[agent].maxWait = e.waitHours;
        byAgent[agent].oldest = e;
      }
    });

    return Object.entries(byAgent)
      .map(([agent, data]) => ({
        agent,
        count: data.count,
        maxWait: data.maxWait,
        subject: data.oldest?.subject || '',
        severity: data.maxWait >= 4 ? 'critical' : data.maxWait >= 1 ? 'high' : 'medium',
      }))
      .sort((a, b) => b.maxWait - a.maxWait);
  })();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{greeting}, {userName.split(' ')[0]} 👋</h1>
          <p className="text-[12px] text-gray-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · SirReel HQ</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px]">
            <span className="text-amber-600 font-bold">⚡ {agentAlerts.length > 0 ? `${agentAlerts.reduce((s,a) => s + a.count, 0)} unanswered emails` : 'All caught up'}</span>
          </div>
          {rwConnected && (
            <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-700 font-semibold">
              🔴 Live · RentalWorks
            </div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3 mb-4">
        <div className="p-3 bg-white rounded-xl border border-gray-200">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Units Out</div>
          <div className="text-2xl font-extrabold text-gray-900">{totalOut}</div>
          <div className="text-[10px] text-gray-500">of {totalUnits} · <span className="text-emerald-600 font-semibold">{totalAvail} avail</span></div>
        </div>
        <div className="p-3 bg-white rounded-xl border border-gray-200">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Active Jobs</div>
          <div className="text-2xl font-extrabold text-gray-900">{rwConnected ? activeJobs.filter(o=>o.status==='ACTIVE').length : '—'}</div>
          <div className="text-[10px] text-gray-500">{rwConnected ? `${activeJobs.filter(o=>o.status==='CONFIRMED').length} confirmed` : 'Loading...'}</div>
        </div>
        <div className="p-3 bg-white rounded-xl border border-gray-200">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">In Maintenance</div>
          <div className="text-2xl font-extrabold text-red-600">{totalMaint}</div>
          <div className="text-[10px] text-gray-500">$17,000 est. repairs</div>
        </div>
        <div className="p-3 bg-white rounded-xl border border-gray-200">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Revenue MTD</div>
          <div className="text-2xl font-extrabold text-emerald-600">{rwConnected ? fmtK(revenueMTD) : "$—"}</div>
          <div className="text-[10px] text-gray-400">{rwConnected ? "from RentalWorks" : "connecting..."}</div>
        </div>
        <div className="p-3 bg-white rounded-xl border border-gray-200">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Outstanding</div>
          <div className="text-2xl font-extrabold text-amber-600">{rwConnected ? fmtK(outstanding) : "$—"}</div>
          <div className="text-[10px] text-gray-500">{rwConnected ? `across ${activeJobs.length} orders` : "loading..."}</div>
        </div>
      </div>

      {/* TOP ROW: Email Inbox + Alerts */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Email — needs reply feed */}
        <div className="col-span-2 p-4 bg-white rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Latest Emails</div>
              {emails.filter(e => e.needsReply).length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-bold">
                  {emails.filter(e => e.needsReply && e.priority <= 2).length} need reply
                </span>
              )}
            </div>
            <a href="https://mail.google.com" target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-blue-600 font-semibold hover:underline">Open Gmail ↗</a>
          </div>
          {emailLoading ? (
            <div className="text-[11px] text-gray-400 py-4 text-center">Loading...</div>
          ) : emails.length === 0 ? (
            <div className="text-[11px] text-gray-400 py-4 text-center">No emails</div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {emails.filter(e => (e.priority <= 2 || e.category === "BOOKING_INQUIRY") && !dismissedEmails.has(e.gmailMessageId)).slice(0, 8).map((e, i) => {
                const cat = CATEGORY_CFG[e.category] || CATEGORY_CFG.GENERAL;
                const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${e.threadId || e.gmailMessageId || ''}`;
                const waitH = e.waitHours || 0;
                return (
                  <a key={i} href={gmailUrl} target="_blank" rel="noopener noreferrer"
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-colors hover:shadow-sm ${
                      e.needsReply && waitH >= 4 ? 'border-red-200 bg-red-50/50' :
                      e.needsReply && waitH >= 1 ? 'border-amber-200 bg-amber-50/40' :
                      'border-gray-100 bg-white hover:bg-gray-50'
                    }`}>
                    <div className="flex-shrink-0 pt-0.5">
                      {!e.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 block" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className={`text-[12px] truncate ${!e.isRead ? 'font-bold text-gray-900' : 'font-medium text-gray-600'}`}>
                          {e.fromAddress?.match(/^([^<]+)</)?.[1]?.trim() || e.fromAddress?.split('@')[0] || 'Unknown'}
                        </span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {e.needsReply && waitH >= 1 && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${waitH >= 4 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                              ↩ {e.waitLabel}
                            </span>
                          )}
                          <span className="text-[9px] text-gray-400">{timeAgo(e.sentAt)}</span>
                        </div>
                      </div>
                      <div className={`text-[11px] truncate mb-0.5 ${!e.isRead ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>{e.subject}</div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${cat.bg} ${cat.color}`}>{cat.label}</span>
                        {e.needsReply && waitH >= 1 && <span className="text-[8px] font-bold text-red-600">↩ needs reply</span>}
                      </div>
                      {(e.aiSummary || e.snippet) && (
                        <div className="text-[10px] text-gray-400 leading-relaxed line-clamp-2">
                          {e.aiSummary || e.snippet}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <span className="text-gray-300 text-[10px]">↗</span>
                      <button
                        onClick={e2 => { e2.preventDefault(); e2.stopPropagation(); setDismissedEmails(prev => new Set([...prev, e.gmailMessageId])); }}
                        className="text-[11px] text-gray-400 hover:text-red-500 font-bold leading-none px-1">×</button>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* Needs Attention — live alerts + team response */}
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">⚡ Needs Attention</div>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">

            {/* System alerts */}
            {alerts.map((alert: any) => (
              <div key={alert.id} className={`rounded-lg border text-[11px] overflow-hidden ${
                alert.severity === 'critical' ? 'border-red-200 bg-red-50' :
                alert.severity === 'high' ? 'border-amber-200 bg-amber-50' :
                'border-gray-200 bg-gray-50'}`}>
                <div className="px-3 py-2 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className={`font-bold flex items-center gap-1 ${
                      alert.severity === 'critical' ? 'text-red-700' :
                      alert.severity === 'high' ? 'text-amber-700' : 'text-gray-700'}`}>
                      {alert.severity === 'critical' ? '🔴' : alert.severity === 'high' ? '🟡' : '⚪'}
                      {alert.link ? (
                        <a href={alert.link} className="hover:underline">{alert.title}</a>
                      ) : alert.title}
                    </div>
                    {alert.body && <div className="text-[10px] text-gray-500 mt-0.5">{alert.body}</div>}
                  </div>
                  <button
                    onClick={async () => {
                      const email = 'wes@sirreel.com'
                      await fetch('/api/alerts/dismiss', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ alertId: alert.id, userEmail: email }),
                      })
                      setAlerts((prev: any[]) => prev.filter((a: any) => a.id !== alert.id))
                    }}
                    className="text-[9px] text-gray-400 hover:text-gray-600 font-semibold flex-shrink-0 px-1.5 py-0.5 rounded hover:bg-white/60">
                    dismiss
                  </button>
                </div>
              </div>
            ))}

            {/* Team email response */}
            {agentAlerts.map((a, i) => {
              const isExpanded = expandedAgent === a.agent;
              const agentEmails = emails.filter((e: any) => {
                const inbox = (e.toAddresses || [])[0] || '';
                const AGENT_INBOX: Record<string,string> = {
                  'jose@sirreel.com': 'Jose', 'oliver@sirreel.com': 'Oliver',
                  'info@sirreel.com': 'Info', 'ana@sirreel.com': 'Ana',
                };
                return e.needsReply && AGENT_INBOX[inbox] === a.agent;
              });
              return (
                <div key={i} className={`rounded-lg border text-[11px] overflow-hidden ${
                  a.severity === 'critical' ? 'border-red-200' :
                  a.severity === 'high' ? 'border-amber-200' : 'border-gray-200'}`}>
                  <div
                    onClick={() => setExpandedAgent(isExpanded ? null : a.agent)}
                    className={`px-3 py-2 cursor-pointer flex items-center justify-between ${
                      a.severity === 'critical' ? 'bg-red-50 text-red-700' :
                      a.severity === 'high' ? 'bg-amber-50 text-amber-700' :
                      'bg-gray-50 text-gray-600'}`}>
                    <span className="font-bold">{a.severity === 'critical' ? '🔴' : a.severity === 'high' ? '🟡' : '⚪'} {a.agent}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{a.count} unanswered</span>
                      <span className="text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="bg-white divide-y divide-gray-50 max-h-48 overflow-y-auto">
                      {agentEmails.map((e: any, j: number) => {
                        const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${e.threadId || e.gmailMessageId || ''}`;
                        return (
                          <a key={j} href={gmailUrl} target="_blank" rel="noopener noreferrer"
                            className="block px-3 py-2 hover:bg-gray-50 transition-colors">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-gray-900 truncate">
                                {e.fromAddress?.match(/^([^<]+)</)?.[1]?.trim() || e.fromAddress?.split('@')[0] || 'Unknown'}
                              </span>
                              <span className="text-[9px] text-gray-400 flex-shrink-0">↩ {e.waitLabel}</span>
                            </div>
                            <div className="text-[10px] text-gray-500 truncate">{e.subject}</div>
                            {(e.aiSummary || e.snippet) && (
                              <div className="text-[9px] text-gray-400 truncate mt-0.5">
                                {(e.aiSummary || e.snippet || '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')}
                              </div>
                            )}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {alerts.length === 0 && agentAlerts.length === 0 && (
              <div className="text-[11px] text-gray-400 py-4 text-center">✅ All caught up</div>
            )}
          </div>
        </div>
      </div>

      {/* Fleet Utilization — moved below email */}
      <div className="p-4 bg-white rounded-xl border border-gray-200 mb-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Fleet Utilization</div>
          <button onClick={() => setShowAllFleet(!showAllFleet)} className="text-[10px] text-blue-600 font-semibold">{showAllFleet ? 'Show active' : 'Show all'}</button>
        </div>
        <div className="space-y-2">
          {displayFleet.map(f => {
            const utilPct = Math.round((f.out / f.total) * 100);
            const maintPct = Math.round((f.maint / f.total) * 100);
            return (
              <div key={f.cat} className="flex items-center gap-3">
                <div className="w-24 flex-shrink-0">
                  <div className="text-[11px] font-semibold text-gray-900">{f.short}</div>
                  <div className="text-[9px] text-gray-400">{f.out}/{f.total} · {f.total-f.out-f.maint} avail</div>
                </div>
                <div className="flex-1">
                  <div className="w-full h-5 bg-gray-100 rounded-full overflow-hidden flex">
                    <div className="h-full rounded-l-full" style={{ width: `${utilPct}%`, backgroundColor: f.color, minWidth: utilPct > 0 ? 16 : 0 }} />
                    {f.maint > 0 && <div className="h-full bg-red-300" style={{ width: `${maintPct}%`, minWidth: 16 }} />}
                  </div>
                </div>
                <div className="w-16 text-right flex-shrink-0">
                  <div className="text-[11px] font-bold text-gray-900">${(f.out * f.rate).toLocaleString()}</div>
                  <div className="text-[9px] text-gray-400">/day</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-2 border-t border-gray-200 flex justify-between text-[11px]">
          <div className="flex gap-3">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-400" /> Booked</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-300" /> Maint</span>
          </div>
          <span className="font-bold text-gray-900">Earning today: <span className="text-emerald-600">${FLEET.reduce((s,f) => s + f.out*f.rate, 0).toLocaleString()}/day</span></span>
        </div>
      </div>

      <div className="mb-4"><CollectionsReportWidget /></div>

      {/* Pending Reviews */}
      <ReviewsWidget />

      {/* Live Active Jobs */}
      {rwConnected && activeJobs.length > 0 && (
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-3">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Active & Confirmed Jobs · Live</div>
            <a href="/bookings" className="text-[10px] text-blue-600 font-semibold hover:underline">View all {rwOrders.length} →</a>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {activeJobs.slice(0, 8).map(o => (
              <div key={o.orderId} className={`p-2.5 rounded-lg border ${o.status === 'ACTIVE' ? 'border-l-2 border-l-emerald-400 border-gray-100' : 'border-l-2 border-l-blue-400 border-gray-100'}`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="text-[11px] font-bold text-gray-900 truncate">{o.customer}</div>
                    <div className="text-[9px] text-gray-500 truncate">{o.description}</div>
                    <div className="text-[9px] text-gray-400">{o.agent}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[11px] font-bold text-gray-900">${o.total.toLocaleString()}</div>
                    <span className={`px-1 py-0.5 rounded text-[7px] font-bold ${o.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{o.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
