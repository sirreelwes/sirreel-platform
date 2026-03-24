'use client';

import { useState, useMemo, useEffect } from 'react';
import JobDrawer from '@/components/jobs/JobDrawer';

function toDS(d: Date): string { return d.toISOString().split('T')[0]; }
function addDays(ds: string, n: number): string { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return toDS(d); }
function diffDays(a: string, b: string): number { return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000); }
function fDate(ds: string): string { if (!ds) return ''; return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
const today = toDS(new Date());

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ACTIVE:     { label: 'Active',     color: 'text-emerald-700', bg: 'bg-emerald-50',  border: '#34d399' },
  CONFIRMED:  { label: 'Confirmed',  color: 'text-blue-700',    bg: 'bg-blue-50',     border: '#60a5fa' },
  COMPLETE:   { label: 'Complete',   color: 'text-gray-500',    bg: 'bg-gray-50',     border: '#d1d5db' },
  CANCELLED:  { label: 'Cancelled',  color: 'text-red-600',     bg: 'bg-red-50',      border: '#fca5a5' },
  CLOSED:     { label: 'Closed',     color: 'text-gray-400',    bg: 'bg-gray-50',     border: '#e5e7eb' },
};

const AGENTS = ['Jose', 'Oliver', 'Dani', 'Christian'];
const VEHICLE_TYPES = [
  'Cube Truck', 'Cargo Van w/ LG', 'Cargo Van w/o LG', 'Passenger Van',
  'PopVan', 'Camera Cube', 'DLUX', 'ProScout/VTR', 'Studio', 'Other'
];
const PAGE_SIZE = 25;

type RWOrder = {
  orderId: string; orderNumber: string; description: string; customer: string;
  agent: string; status: string; total: number; startDate: string; endDate: string;
  department: string; poNumber: string; dealType: string; marketType: string;
};

export default function BookingsPage() {
  const [orders, setOrders] = useState<RWOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterAgent, setFilterAgent] = useState<string>('ALL');
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState('');
  const [page, setPage] = useState(1);
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null);
  const [drawerOrderNumber, setDrawerOrderNumber] = useState('');

  const [nContact, setNContact] = useState('');
  const [nCompany, setNCompany] = useState('');
  const [nPhone, setNPhone] = useState('');
  const [nEmail, setNEmail] = useState('');
  const [nJob, setNJob] = useState('');
  const [nVehicle, setNVehicle] = useState('Cube Truck');
  const [nQty, setNQty] = useState(1);
  const [nStart, setNStart] = useState(addDays(today, 1));
  const [nEnd, setNEnd] = useState(addDays(today, 3));
  const [nAgent, setNAgent] = useState('Jose');
  const [nNotes, setNNotes] = useState('');
  const [nPoNumber, setNPoNumber] = useState('');

  useEffect(() => {
    fetch('/api/rentalworks').then(r => r.json()).then(data => {
      if (data?.orders?.Rows) {
        const cols = data.orders.ColumnIndex;
        const rows: RWOrder[] = data.orders.Rows.map((r: any[]) => ({
          orderId:     r[cols.OrderId],
          orderNumber: r[cols.OrderNumber],
          description: r[cols.Description],
          customer:    r[cols.Customer],
          agent:       (r[cols.CustomerServiceRepresentative] || '').split(',').reverse().join(' ').trim(),
          status:      r[cols.Status],
          total:       Number(r[cols.Total]) || 0,
          startDate:   r[cols.EstimatedStartDate] || '',
          endDate:     r[cols.EstimatedStopDate] || '',
          department:  r[cols.Department] || '',
          poNumber:    r[cols.PoNumber] || '',
          dealType:    r[cols.DealType] || '',
          marketType:  r[cols.MarketType] || '',
        }));
        setOrders(rows);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    setPage(1);
    return orders.filter(o => {
      if (filterStatus !== 'ALL' && o.status !== filterStatus) return false;
      if (filterAgent !== 'ALL' && !o.agent.toLowerCase().includes(filterAgent.toLowerCase())) return false;
      if (search) {
        const q = search.toLowerCase();
        return o.customer.toLowerCase().includes(q) ||
          o.description.toLowerCase().includes(q) ||
          o.orderNumber.toLowerCase().includes(q) ||
          o.poNumber.toLowerCase().includes(q);
      }
      return true;
    });
  }, [orders, filterStatus, filterAgent, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: orders.length };
    orders.forEach(o => { c[o.status] = (c[o.status] || 0) + 1; });
    return c;
  }, [orders]);

  const totalValue = useMemo(() => filtered.reduce((s, o) => s + o.total, 0), [filtered]);

  function resetForm() {
    setNContact(''); setNCompany(''); setNPhone(''); setNEmail('');
    setNJob(''); setNVehicle('Cube Truck'); setNQty(1);
    setNStart(addDays(today, 1)); setNEnd(addDays(today, 3));
    setNAgent('Jose'); setNNotes(''); setNPoNumber('');
  }

  function submitInquiry() {
    const days = diffDays(nStart, nEnd) + 1;
    setToast(`✓ Inquiry logged — ${nContact} · ${nQty}× ${nVehicle} · ${days}d · Create order in RentalWorks`);
    setTimeout(() => setToast(''), 5000);
    setShowNew(false);
    resetForm();
  }

  function openDrawer(o: RWOrder) {
    setDrawerOrderId(o.orderId);
    setDrawerOrderNumber(o.orderNumber);
  }

  const days = diffDays(nStart, nEnd) + 1;

  return (
    <div>
      <JobDrawer
        orderId={drawerOrderId}
        orderNumber={drawerOrderNumber}
        onClose={() => setDrawerOrderId(null)}
      />

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Jobs</h1>
          <p className="text-[11px] text-gray-400">
            {loading ? 'Loading from RentalWorks...' : `${orders.length} total orders · Live from RentalWorks`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-emerald-600 font-semibold px-2 py-1 bg-emerald-50 rounded-lg border border-emerald-200">
            🔴 Live · RentalWorks
          </span>
          <button onClick={() => setShowNew(true)}
            className="px-4 py-2 rounded-lg bg-black text-white text-[12px] font-bold hover:bg-gray-800">
            + New Inquiry
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 mb-4">
        {['ACTIVE', 'CONFIRMED', 'COMPLETE', 'CANCELLED', 'CLOSED'].map(s => {
          const cfg = STATUS_CONFIG[s];
          return (
            <button key={s} onClick={() => setFilterStatus(filterStatus === s ? 'ALL' : s)}
              className={`p-3 rounded-xl border text-left transition-all ${filterStatus === s ? 'ring-2 ring-offset-1 ring-black' : ''} ${cfg.bg} border-gray-200`}>
              <div className={`text-xl font-extrabold ${cfg.color}`}>{counts[s] || 0}</div>
              <div className="text-[9px] font-bold text-gray-400 uppercase">{cfg.label}</div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search client, order #, description, PO..."
          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
        <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none">
          <option value="ALL">All Agents</option>
          {AGENTS.map(a => <option key={a}>{a}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none">
          <option value="ALL">All Statuses ({counts.ALL || 0})</option>
          {Object.keys(STATUS_CONFIG).map(s => (
            <option key={s} value={s}>{STATUS_CONFIG[s].label} ({counts[s] || 0})</option>
          ))}
        </select>
      </div>

      <div className="flex justify-between items-center mb-2">
        <span className="text-[11px] text-gray-400">
          {filtered.length} orders{totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}
        </span>
        <span className="text-[11px] font-bold text-gray-700">Total: <span className="text-emerald-600">${totalValue.toLocaleString()}</span></span>
      </div>

      {loading && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-3xl mb-2">⏳</div>
          <div className="text-[13px]">Loading orders from RentalWorks...</div>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-3xl mb-2">📋</div>
          <div className="text-[13px]">No orders match your filters</div>
        </div>
      )}

      <div className="space-y-2">
        {paginated.map(o => {
          const cfg = STATUS_CONFIG[o.status] || STATUS_CONFIG.CLOSED;
          const dur = o.startDate && o.endDate ? diffDays(o.startDate, o.endDate) + 1 : null;
          return (
            <div key={o.orderId}
              onClick={() => openDrawer(o)}
              className="p-3 rounded-xl border bg-white hover:shadow-md hover:border-gray-300 transition-all cursor-pointer active:scale-[0.99]"
              style={{ borderLeftWidth: 3, borderLeftColor: cfg.border }}>
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-[13px] font-bold text-gray-900">{o.customer}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${cfg.color} ${cfg.bg}`}>{cfg.label}</span>
                    {o.marketType && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-50 text-purple-600">{o.marketType}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-700 font-medium truncate">{o.description}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-gray-400">#{o.orderNumber}</span>
                    {o.department && <span className="text-[10px] text-gray-400">· {o.department}</span>}
                    {o.agent && <span className="text-[10px] text-gray-400">· {o.agent}</span>}
                    {o.poNumber && <span className="text-[10px] text-blue-500">· PO: {o.poNumber}</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[15px] font-extrabold text-gray-900">${o.total.toLocaleString()}</div>
                  {o.startDate && (
                    <div className="text-[10px] text-gray-400">
                      {fDate(o.startDate)}{o.endDate ? ` – ${fDate(o.endDate)}` : ''}
                      {dur ? <span className="ml-1 text-gray-300">({dur}d)</span> : ''}
                    </div>
                  )}
                  <div className="text-[9px] text-gray-300 mt-0.5">tap to view →</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-4 py-2 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
            ← Previous
          </button>
          <span className="text-[11px] text-gray-400">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-4 py-2 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
            Next →
          </button>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => { setShowNew(false); resetForm(); }}>
          <div className="bg-white rounded-2xl w-[480px] max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-[16px] font-bold text-gray-900">New Inquiry</h2>
                <p className="text-[11px] text-gray-400">Log inquiry · create order in RentalWorks</p>
              </div>
              <button onClick={() => { setShowNew(false); resetForm(); }} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Contact</div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={nContact} onChange={e => setNContact(e.target.value)} placeholder="Name *" className="px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                  <input value={nCompany} onChange={e => setNCompany(e.target.value)} placeholder="Company *" className="px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                  <input value={nPhone} onChange={e => setNPhone(e.target.value)} placeholder="Phone" className="px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                  <input value={nEmail} onChange={e => setNEmail(e.target.value)} placeholder="Email" className="px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Job</div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={nJob} onChange={e => setNJob(e.target.value)} placeholder="Job / Production name *" className="px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400 col-span-2" />
                  <input value={nPoNumber} onChange={e => setNPoNumber(e.target.value)} placeholder="PO Number" className="px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                  <select value={nAgent} onChange={e => setNAgent(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400">
                    {AGENTS.map(a => <option key={a}>{a}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Vehicle Request</div>
                <div className="grid grid-cols-[2fr_1fr] gap-2 mb-2">
                  <select value={nVehicle} onChange={e => setNVehicle(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400">
                    {VEHICLE_TYPES.map(v => <option key={v}>{v}</option>)}
                  </select>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setNQty(Math.max(1, nQty - 1))} className="w-8 h-9 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 font-bold">-</button>
                    <span className="w-8 text-center text-[13px] font-bold">{nQty}</span>
                    <button onClick={() => setNQty(nQty + 1)} className="w-8 h-9 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 font-bold">+</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[9px] text-gray-400 mb-0.5">Pickup Date</div>
                    <input type="date" value={nStart} onChange={e => setNStart(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-400 mb-0.5">Return Date</div>
                    <input type="date" value={nEnd} onChange={e => setNEnd(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                  </div>
                </div>
                {days > 0 && (
                  <div className="mt-2 p-2 rounded-lg bg-gray-50 border border-gray-100 text-[11px] text-gray-500">
                    {nQty}× {nVehicle} · {days} day{days !== 1 ? 's' : ''} · {fDate(nStart)} – {fDate(nEnd)}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Notes</div>
                <textarea value={nNotes} onChange={e => setNNotes(e.target.value)} placeholder="Delivery instructions, special requests, add-ons needed..." rows={3} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400 resize-none" />
              </div>
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-[11px] text-blue-700">
                💡 After logging, create the order in <strong>RentalWorks</strong> to confirm availability and generate the contract.
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-2">
              <button onClick={() => { setShowNew(false); resetForm(); }} className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-600 text-[13px] font-semibold hover:bg-gray-200">Cancel</button>
              <button onClick={submitInquiry} disabled={!nContact || !nCompany || !nJob}
                className={`flex-2 px-6 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${nContact && nCompany && nJob ? 'bg-black text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                Log Inquiry →
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-3 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold shadow-lg z-50 max-w-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
