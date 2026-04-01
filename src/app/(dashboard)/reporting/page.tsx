'use client';

import { useState } from 'react';

// ═══ Helpers ═══
function toDS(d: Date): string { return d.toISOString().split('T')[0]; }
function addDays(ds: string, n: number): string { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return toDS(d); }
function fDate(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
const today = toDS(new Date());
const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// ═══ Component ═══
export default function ReportingPage() {
  const [period, setPeriod] = useState<'week' | 'month' | 'quarter' | 'year'>('month');

  // Revenue data
  const revenue = {
    week: { total: 18640, prev: 15200, jobs: 6 },
    month: { total: 72400, prev: 64800, jobs: 24 },
    quarter: { total: 198500, prev: 176200, jobs: 68 },
    year: { total: 742000, prev: 680000, jobs: 284 },
  }[period];
  const revChange = Math.round(((revenue.total - revenue.prev) / revenue.prev) * 100);

  // Pipeline
  const pipeline = [
    { stage: 'Inquiry', count: 1, value: 11200, color: '#38bdf8' },
    { stage: 'Hold', count: 3, value: 15715, color: '#fbbf24' },
    { stage: 'Quoted', count: 1, value: 2100, color: '#c084fc' },
    { stage: 'Booked', count: 3, value: 30100, color: '#60a5fa' },
    { stage: 'Active', count: 3, value: 15565, color: '#34d399' },
  ];
  const pipelineTotal = pipeline.reduce((s, p) => s + p.value, 0);

  // Fleet utilization
  const fleet = [
    { cat: 'Cube Truck', total: 41, booked: 21, maint: 4, avail: 16, rate: 175 },
    { cat: 'Cargo Van', total: 38, booked: 16, maint: 4, avail: 18, rate: 200 },
    { cat: 'PopVan', total: 9, booked: 2, maint: 2, avail: 5, rate: 400 },
    { cat: 'DLUX', total: 8, booked: 4, maint: 0, avail: 4, rate: 450 },
    { cat: 'Camera Cube', total: 7, booked: 2, maint: 0, avail: 5, rate: 200 },
    { cat: 'Passenger Van', total: 10, booked: 3, maint: 1, avail: 6, rate: 175 },
    { cat: 'Studios', total: 10, booked: 2, maint: 0, avail: 8, rate: 3000 },
    { cat: 'ProScout/VTR', total: 3, booked: 1, maint: 0, avail: 2, rate: 450 },
    { cat: 'Stakebed', total: 3, booked: 0, maint: 0, avail: 3, rate: 200 },
  ];
  const totalUnits = fleet.reduce((s, f) => s + f.total, 0);
  const totalBooked = fleet.reduce((s, f) => s + f.booked, 0);
  const totalMaint = fleet.reduce((s, f) => s + f.maint, 0);
  const totalAvail = fleet.reduce((s, f) => s + f.avail, 0);
  const utilizationPct = Math.round((totalBooked / totalUnits) * 100);

  // Agent performance
  const agents = [
    { name: 'Jose Pacheco', role: 'Sales Director', jobs: 18, revenue: 48200, clients: 13, pipeline: 38500, topClient: 'Terry Meadows' },
    { name: 'Oliver Carlson', role: 'Account Mgr', jobs: 5, revenue: 18400, clients: 3, pipeline: 8250, topClient: 'Justin Kappenstein' },
    { name: 'Dani Novoa', role: 'COO', jobs: 2, revenue: 5800, clients: 2, pipeline: 0, topClient: 'Maddie Harmon' },
  ];

  // Top clients this period
  const topClients = [
    { name: 'Justin Kappenstein', company: 'Justin K Prod', spend: 18900, jobs: 4 },
    { name: 'Terry Meadows', company: 'Cinepower', spend: 14200, jobs: 3 },
    { name: 'Nathan Israel', company: 'Nathan Israel Prod', spend: 12400, jobs: 2 },
    { name: 'Elli Legerski', company: 'Elli Legerski Prod', spend: 8600, jobs: 2 },
    { name: 'Ella Swanstrom', company: 'Fabletics', spend: 19350, jobs: 1 },
  ];

  // Maintenance costs
  const maintCosts = {
    total: 21450,
    inShop: 4,
    avgRepair: 2680,
    topIssue: 'SC #36 roof damage — $5,500',
  };

  // Recent activity
  const activity = [
    { time: '2m ago', text: 'Beth Schiffman placed on HOLD — Greystone Pilot', type: 'hold' },
    { time: '15m ago', text: 'Stephen Predisik hold via Oliver — Paramount Drama', type: 'hold' },
    { time: '1h ago', text: 'Terry Meadows job ACTIVE — 6× Cube out', type: 'active' },
    { time: '2h ago', text: 'Brandon McClover inquiry — 8× Cube for Megan MV', type: 'inquiry' },
    { time: '3h ago', text: 'Email: Noelle Victoria (Purina) — needs quote', type: 'email' },
    { time: '4h ago', text: 'Email: Maggie Lee (BDG/Toyota) — OVERDUE', type: 'urgent' },
    { time: '5h ago', text: 'Cube #24(A) motor diagnosis at High Tech — $4,500 est', type: 'maint' },
    { time: 'Yesterday', text: 'Jason Mayfield booked Cold Front MV — $6,040', type: 'booked' },
  ];

  const activityIcons: Record<string, string> = { hold: '⏱', active: '🟢', inquiry: '📞', email: '📧', urgent: '🔴', maint: '🔧', booked: '✓' };

  // Monthly revenue chart (last 6 months)
  const monthlyRev = [
    { month: 'Oct', value: 58000 },
    { month: 'Nov', value: 62000 },
    { month: 'Dec', value: 48000 },
    { month: 'Jan', value: 55000 },
    { month: 'Feb', value: 64800 },
    { month: 'Mar', value: 72400 },
  ];
  const maxRev = Math.max(...monthlyRev.map(m => m.value));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Reporting</h1>
          <p className="text-[12px] text-gray-500">{monthName} · SirReel HQ</p>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {(['week', 'month', 'quarter', 'year'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1 rounded-md text-[11px] font-semibold capitalize ${period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{p}</button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Revenue', value: '$' + revenue.total.toLocaleString(), sub: `${revChange > 0 ? '+' : ''}${revChange}% vs prev`, color: revChange > 0 ? 'text-emerald-600' : 'text-red-600', bg: 'bg-emerald-50', icon: '💰' },
          { label: 'Pipeline', value: '$' + pipelineTotal.toLocaleString(), sub: `${pipeline.reduce((s, p) => s + p.count, 0)} jobs in progress`, color: 'text-blue-600', bg: 'bg-blue-50', icon: '📊' },
          { label: 'Utilization', value: utilizationPct + '%', sub: `${totalBooked} of ${totalUnits} units booked`, color: utilizationPct > 50 ? 'text-emerald-600' : 'text-amber-600', bg: 'bg-amber-50', icon: '🚛' },
          { label: 'Maint Cost', value: '$' + maintCosts.total.toLocaleString(), sub: `${maintCosts.inShop} vehicles in shop`, color: 'text-red-600', bg: 'bg-red-50', icon: '🔧' },
        ].map(kpi => (
          <div key={kpi.label} className="p-4 bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{kpi.label}</span>
              <span className="text-lg">{kpi.icon}</span>
            </div>
            <div className="text-2xl font-extrabold text-gray-900">{kpi.value}</div>
            <div className={`text-[11px] font-semibold mt-0.5 ${kpi.color}`}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Revenue chart */}
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Monthly Revenue (6mo)</div>
          <div className="flex items-end gap-2 h-36">
            {monthlyRev.map(m => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-[9px] font-bold text-gray-500">${(m.value / 1000).toFixed(0)}K</div>
                <div className="w-full rounded-t-md bg-blue-400 transition-all" style={{ height: `${(m.value / maxRev) * 100}%`, minHeight: 4 }} />
                <div className="text-[10px] text-gray-500">{m.month}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline breakdown */}
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Pipeline Breakdown</div>
          <div className="space-y-2">
            {pipeline.map(p => (
              <div key={p.stage}>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="font-semibold text-gray-700">{p.stage}</span>
                    <span className="text-gray-400">{p.count} jobs</span>
                  </div>
                  <span className="font-bold text-gray-900">${p.value.toLocaleString()}</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(p.value / pipelineTotal) * 100}%`, backgroundColor: p.color }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-3 pt-2 border-t border-gray-200 text-[12px] font-bold">
            <span className="text-gray-700">Total Pipeline</span>
            <span className="text-gray-900">${pipelineTotal.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Three column layout */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Agent performance */}
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Agent Performance</div>
          <div className="space-y-3">
            {agents.map(a => (
              <div key={a.name} className="pb-3 border-b border-gray-100 last:border-0 last:pb-0">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <div className="text-[13px] font-bold text-gray-900">{a.name}</div>
                    <div className="text-[10px] text-gray-400">{a.role}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-extrabold text-amber-700">${a.revenue.toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex gap-3 text-[10px] text-gray-500">
                  <span>{a.jobs} jobs</span>
                  <span>{a.clients} clients</span>
                  <span>${a.pipeline.toLocaleString()} pipeline</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top clients */}
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Top Clients ({period})</div>
          <div className="space-y-2">
            {topClients.map((c, i) => (
              <div key={c.name} className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-gray-900 truncate">{c.name}</div>
                  <div className="text-[10px] text-gray-400">{c.company} · {c.jobs} jobs</div>
                </div>
                <span className="text-[12px] font-bold text-amber-700">${c.spend.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Fleet utilization */}
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Fleet Utilization</div>
          <div className="space-y-1.5">
            {fleet.filter(f => f.total > 3).map(f => {
              const util = Math.round((f.booked / f.total) * 100);
              return (
                <div key={f.cat}>
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="text-gray-700 font-medium">{f.cat}</span>
                    <span className="text-gray-400">{f.booked}/{f.total} ({util}%)</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden flex">
                    <div className="h-full bg-blue-400" style={{ width: `${(f.booked / f.total) * 100}%` }} />
                    <div className="h-full bg-red-300" style={{ width: `${(f.maint / f.total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-2 border-t border-gray-200 flex gap-3 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Booked</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-300" /> Maint</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-200" /> Avail</span>
          </div>
        </div>
      </div>

      {/* Activity feed + alerts */}
      <div className="grid grid-cols-2 gap-4">
        {/* Activity feed */}
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Recent Activity</div>
          <div className="space-y-2">
            {activity.map((a, i) => (
              <div key={i} className={`flex gap-2 text-[11px] py-1.5 ${a.type === 'urgent' ? 'bg-red-50 -mx-2 px-2 rounded-lg' : ''}`}>
                <span className="flex-shrink-0">{activityIcons[a.type] || '•'}</span>
                <div className="flex-1 min-w-0">
                  <span className={`${a.type === 'urgent' ? 'text-red-700 font-semibold' : 'text-gray-700'}`}>{a.text}</span>
                </div>
                <span className="text-gray-400 flex-shrink-0 text-[10px]">{a.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts & actions needed */}
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">⚡ Needs Attention</div>
          <div className="space-y-2">
            {[
              { text: '2 urgent email inquiries unanswered', severity: 'critical', action: 'Open Inbox' },
              { text: 'Jason Mayfield — deposit not received, delivery tomorrow', severity: 'high', action: 'Follow Up' },
              { text: 'Fabletics — COI still missing, new client', severity: 'high', action: 'Request COI' },
              { text: 'SC #36 roof damage — $5,500 repair, Nathan Israel job', severity: 'medium', action: 'View Claim' },
              { text: 'Beth Schiffman hold expires today — $8,875 job', severity: 'medium', action: 'Send Quote' },
              { text: 'Pop #3 transmission — parts back-ordered 6+ weeks', severity: 'low', action: 'View' },
            ].map((alert, i) => (
              <div key={i} className={`flex items-center justify-between p-2 rounded-lg border ${
                alert.severity === 'critical' ? 'bg-red-50 border-red-200' :
                alert.severity === 'high' ? 'bg-amber-50 border-amber-200' :
                'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] ${alert.severity === 'critical' ? 'text-red-500' : alert.severity === 'high' ? 'text-amber-500' : 'text-gray-400'}`}>
                    {alert.severity === 'critical' ? '🔴' : alert.severity === 'high' ? '🟡' : '⚪'}
                  </span>
                  <span className="text-[11px] text-gray-700 truncate">{alert.text}</span>
                </div>
                <button className="text-[10px] font-semibold text-blue-600 hover:text-blue-700 flex-shrink-0 ml-2">{alert.action}</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
