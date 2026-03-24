'use client';
import { useState, useEffect, useMemo } from 'react';

function fDate(ds: string): string {
  if (!ds) return '';
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function toDS(d: Date): string { return d.toISOString().split('T')[0]; }
const today = toDS(new Date());
const nowHour = new Date().getHours();
const greeting = nowHour < 12 ? 'Good morning' : nowHour < 17 ? 'Good afternoon' : 'Good evening';

type RWOrder = {
  orderId: string; orderNumber: string; description: string; customer: string;
  agent: string; status: string; total: number; startDate: string; endDate: string;
};

export default function SalesDashboard({ agentName }: { agentName: string }) {
  const [orders, setOrders] = useState<RWOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [inboxEmails, setInboxEmails] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/gmail/check-replies').then(r => r.json()).then(d => {
      const all = d.all || [];
      const seen = new Set<string>();
      const deduped = all.filter((e: any) => {
        const key = e.subject.replace(/^(Re:|Fwd:|RE:|FW:)\s*/gi, '').trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setInboxEmails(deduped.filter((e: any) => e.priority <= 2).slice(0, 5));
    }).catch(() => {});

    fetch('/api/rentalworks').then(r => r.json()).then(data => {
      if (data?.orders?.Rows) {
        const cols = data.orders.ColumnIndex;
        const rows: RWOrder[] = data.orders.Rows.map((r: any[]) => ({
          orderId:     r[cols.OrderId],
          orderNumber: r[cols.OrderNumber],
          description: r[cols.Description],
          customer:    r[cols.Customer],
          agent:       (r[cols.Agent] || r[cols.CustomerServiceRepresentative] || '').split(',').reverse().join(' ').trim(),
          status:      r[cols.Status],
          total:       Number(r[cols.Total]) || 0,
          startDate:   r[cols.EstimatedStartDate] || '',
          endDate:     r[cols.EstimatedStopDate] || '',
        }));
        setOrders(rows);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const myOrders = useMemo(() =>
    orders.filter(o => {
      const first = agentName.split(' ')[0].toLowerCase();
      const last = agentName.split(' ')[1]?.toLowerCase() || '';
      return o.agent.toLowerCase().includes(first) || o.agent.toLowerCase().includes(last);
    }),
    [orders, agentName]
  );

  const active = myOrders.filter(o => o.status === 'ACTIVE');
  const confirmed = myOrders.filter(o => o.status === 'CONFIRMED');
  const goingOut = active.filter(o => o.startDate === today);
  const returning = active.filter(o => o.endDate === today);
  const pipeline = [...active, ...confirmed];
  const pipelineValue = pipeline.reduce((s, o) => s + o.total, 0);
  const criticalCount = inboxEmails.filter(e => e.priority === 0).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{greeting}, {agentName.split(' ')[0]} 👋</h1>
          <p className="text-[12px] text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · SirReel Fleet HQ</p>
        </div>
        <span className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-700 font-semibold">🔴 Live · RentalWorks</span>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <a href="/bookings" className="p-4 bg-white rounded-xl border border-gray-200 hover:shadow-sm block">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">My Active Jobs</div>
          <div className="text-3xl font-extrabold text-gray-900">{active.length}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{confirmed.length} confirmed upcoming</div>
        </a>
        <a href="/bookings" className="p-4 bg-white rounded-xl border border-gray-200 hover:shadow-sm block">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Pipeline Value</div>
          <div className="text-3xl font-extrabold text-blue-600">${(pipelineValue/1000).toFixed(1)}K</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{pipeline.length} orders</div>
        </a>
        <a href="/bookings" className="p-4 bg-white rounded-xl border border-gray-200 hover:shadow-sm block">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Movement Today</div>
          <div className="text-3xl font-extrabold text-amber-500">{goingOut.length}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{returning.length} returning</div>
        </a>
        <a href="/inbox" className="p-4 bg-white rounded-xl border border-red-100 hover:shadow-sm block">
          <div className="text-[9px] font-bold text-red-400 uppercase mb-1">⚡ Needs Reply</div>
          <div className="text-3xl font-extrabold text-red-500">{criticalCount}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{inboxEmails.length} total inquiries</div>
        </a>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Inquiry Queue */}
        <div className="col-span-1 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">📬 Inquiry Queue</div>
            <a href="/inbox" className="text-[10px] text-blue-600 font-semibold hover:underline">View all →</a>
          </div>
          <div className="divide-y divide-gray-50 flex-1">
            {inboxEmails.length === 0 && (
              <div className="p-4 text-[11px] text-gray-400 text-center">No pending inquiries</div>
            )}
            {inboxEmails.map((e, i) => (
              <a key={i} href="/inbox" className={`block p-3 hover:bg-gray-50 transition-colors ${e.priority === 0 ? 'border-l-2 border-red-400' : e.priority === 1 ? 'border-l-2 border-amber-400' : 'border-l-2 border-gray-200'}`}>
                <div className="flex justify-between items-start mb-0.5">
                  <span className="text-[12px] font-bold text-gray-900 truncate">{e.fromAddress?.replace(/<.*>/, '').trim()}</span>
                  <span className="text-[9px] text-gray-400 flex-shrink-0 ml-1">{new Date(e.sentAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                <div className="text-[10px] text-gray-600 font-medium truncate">{e.subject}</div>
                <div className="text-[10px] text-gray-400 truncate">{e.snippet}</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${e.priority === 0 ? 'bg-red-50 text-red-600' : e.priority === 1 ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-500'}`}>
                    {e.priority === 0 ? '🔴 Reply now' : e.priority === 1 ? '🟡 High' : '⚪ Normal'}
                  </span>
                  <span className="text-[9px] text-gray-400">{e.category?.replace('_', ' ')}</span>
                </div>
              </a>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
            <a href="/inbox" className="block w-full py-2 rounded-lg bg-black text-white text-[12px] font-bold text-center hover:bg-gray-800">Open Inbox →</a>
          </div>
        </div>

        <div className="col-span-2 space-y-4">
          {/* Today's Movement */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Today's Movement</div>
            </div>
            <div className="p-4 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] font-bold text-amber-600 uppercase mb-2">📤 Going Out ({goingOut.length})</div>
                {goingOut.length === 0 && !loading && <div className="text-[11px] text-gray-400 py-2">None scheduled today</div>}
                <div className="space-y-1.5">
                  {goingOut.map(o => (
                    <a key={o.orderId} href={`/bookings?order=${o.orderId}`} className="block p-2 rounded-lg bg-amber-50 border border-amber-100 hover:opacity-80">
                      <div className="text-[11px] font-bold text-gray-900 truncate">{o.customer}</div>
                      <div className="text-[10px] text-gray-500 truncate">{o.description}</div>
                      <div className="text-[10px] font-bold text-amber-700">${o.total.toLocaleString()}</div>
                    </a>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-emerald-600 uppercase mb-2">📥 Returning ({returning.length})</div>
                {returning.length === 0 && !loading && <div className="text-[11px] text-gray-400 py-2">None returning today</div>}
                <div className="space-y-1.5">
                  {returning.map(o => (
                    <a key={o.orderId} href={`/bookings?order=${o.orderId}`} className="block p-2 rounded-lg bg-emerald-50 border border-emerald-100 hover:opacity-80">
                      <div className="text-[11px] font-bold text-gray-900 truncate">{o.customer}</div>
                      <div className="text-[10px] text-gray-500 truncate">{o.description}</div>
                      <div className="text-[10px] font-bold text-emerald-700">${o.total.toLocaleString()}</div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Pipeline */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">My Pipeline</div>
              <span className="text-[11px] font-bold text-blue-600">${pipelineValue.toLocaleString()} total</span>
            </div>
            {loading && <div className="p-4 text-[12px] text-gray-400 text-center">Loading from RentalWorks...</div>}
            <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {pipeline.slice(0, 12).map(o => (
                <a key={o.orderId} href={`/bookings?order=${o.orderId}`} className="px-4 py-2.5 hover:bg-gray-50 flex justify-between items-center block">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="text-[12px] font-bold text-gray-900 truncate">{o.customer}</div>
                    <div className="text-[10px] text-gray-500 truncate">{o.description}</div>
                    <div className="text-[9px] text-gray-400">#{o.orderNumber} · {fDate(o.startDate)}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[13px] font-extrabold text-gray-900">${o.total.toLocaleString()}</div>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${o.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{o.status}</span>
                  </div>
                </a>
              ))}
              {pipeline.length === 0 && !loading && <div className="p-4 text-[12px] text-gray-400 text-center">No active pipeline</div>}
            </div>
            {pipeline.length > 12 && (
              <div className="px-4 py-2 border-t border-gray-100 text-center">
                <a href="/bookings" className="text-[11px] text-blue-600 font-semibold hover:underline">View all {pipeline.length} orders →</a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
