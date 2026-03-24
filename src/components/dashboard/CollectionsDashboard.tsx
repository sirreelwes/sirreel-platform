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
  agent: string; status: string; total: number; invoicedAmount: number;
  startDate: string; endDate: string; poNumber: string; ccAuthStatus: string;
  billingStart: string; billingEnd: string;
};

const MOCK_CLAIMS = [
  { id: 'c1', vehicle: 'SC #36', client: 'Film Emporium', issue: 'Roof damage', amount: 9700, status: 'Submitted', daysOpen: 14 },
  { id: 'c2', vehicle: 'Cube #15', client: 'Pending COI', issue: 'Scrape damage', amount: 2675, status: 'New', daysOpen: 3 },
  { id: 'c3', vehicle: 'Pop #3', client: 'Justin K Prod', issue: 'Door damage', amount: 1200, status: 'In Review', daysOpen: 22 },
];

const MOCK_COLLECTIONS = [
  { id: 'p1', client: 'Echobend Pictures', amount: 1800, method: 'Visa', ref: 'CP-84821', time: '2h ago', order: '302849' },
  { id: 'p2', client: 'Lune Films', amount: 754, method: 'Amex', ref: 'CP-84819', time: '4h ago', order: '302893' },
];

export default function CollectionsDashboard() {
  const [orders, setOrders] = useState<RWOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPayment, setNewPayment] = useState(false);
  const [pClient, setPClient] = useState('');
  const [pAmount, setPAmount] = useState('');
  const [pMethod, setPMethod] = useState('Visa');
  const [pRef, setPRef] = useState('');
  const [pOrder, setPOrder] = useState('');
  const [collections, setCollections] = useState(MOCK_COLLECTIONS);
  const [toast, setToast] = useState('');

  useEffect(() => {
    fetch('/api/rentalworks').then(r => r.json()).then(data => {
      if (data?.orders?.Rows) {
        const cols = data.orders.ColumnIndex;
        const rows: RWOrder[] = data.orders.Rows.map((r: any[]) => ({
          orderId:       r[cols.OrderId],
          orderNumber:   r[cols.OrderNumber],
          description:   r[cols.Description],
          customer:      r[cols.Customer],
          agent:         (r[cols.CustomerServiceRepresentative] || '').split(',').reverse().join(' ').trim(),
          status:        r[cols.Status],
          total:         Number(r[cols.Total]) || 0,
          invoicedAmount:Number(r[cols.InvoicedAmount]) || 0,
          startDate:     r[cols.EstimatedStartDate] || '',
          endDate:       r[cols.EstimatedStopDate] || '',
          poNumber:      r[cols.PoNumber] || '',
          ccAuthStatus:  r[cols.CreditCardPreAuthorizationStatus] || '',
          billingStart:  r[cols.BillingStartDate] || '',
          billingEnd:    r[cols.BillingEndDate] || '',
        }));
        setOrders(rows);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const outstanding = useMemo(() =>
    orders
      .filter(o => ['ACTIVE','CONFIRMED','COMPLETE'].includes(o.status) && o.total > 0)
      .map(o => ({ ...o, balance: o.total - o.invoicedAmount }))
      .filter(o => o.balance > 0)
      .sort((a, b) => b.balance - a.balance),
    [orders]
  );

  const overdue = useMemo(() =>
    outstanding.filter(o => o.endDate && o.endDate < today && o.status !== 'ACTIVE'),
    [outstanding, today]
  );

  const totalOutstanding = outstanding.reduce((s, o) => s + o.balance, 0);
  const totalOverdue = overdue.reduce((s, o) => s + o.balance, 0);
  const collectedToday = collections.reduce((s, p) => s + p.amount, 0);
  const claimsTotal = MOCK_CLAIMS.reduce((s, c) => s + c.amount, 0);
  const openClaims = MOCK_CLAIMS.filter(c => c.status !== 'Settled').length;

  function logPayment() {
    const p = { id: 'p' + Date.now(), client: pClient, amount: Number(pAmount), method: pMethod, ref: pRef, time: 'Just now', order: pOrder };
    setCollections(prev => [p, ...prev]);
    setToast(`✓ Payment logged — ${pClient} · $${Number(pAmount).toLocaleString()}`);
    setTimeout(() => setToast(''), 4000);
    setNewPayment(false);
    setPClient(''); setPAmount(''); setPRef(''); setPOrder('');
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{greeting}, Ana 👋</h1>
          <p className="text-[12px] text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · Collections & Billing</p>
        </div>
        <button onClick={() => setNewPayment(true)}
          className="px-4 py-2 rounded-lg bg-black text-white text-[12px] font-bold hover:bg-gray-800">
          + Log Payment
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Collected Today</div>
          <div className="text-3xl font-extrabold text-emerald-600">${collectedToday.toLocaleString()}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{collections.length} payments · CardPointe</div>
        </div>
        <div className="p-4 bg-white rounded-xl border border-amber-200">
          <div className="text-[9px] font-bold text-amber-500 uppercase mb-1">Outstanding</div>
          <div className="text-3xl font-extrabold text-amber-600">${(totalOutstanding/1000).toFixed(1)}K</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{outstanding.length} orders · RentalWorks</div>
        </div>
        <div className="p-4 bg-white rounded-xl border border-red-200">
          <div className="text-[9px] font-bold text-red-500 uppercase mb-1">Overdue</div>
          <div className="text-3xl font-extrabold text-red-600">${(totalOverdue/1000).toFixed(1)}K</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{overdue.length} orders past due</div>
        </div>
        <div className="p-4 bg-white rounded-xl border border-purple-200">
          <div className="text-[9px] font-bold text-purple-500 uppercase mb-1">Open Claims</div>
          <div className="text-3xl font-extrabold text-purple-600">${(claimsTotal/1000).toFixed(1)}K</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{openClaims} claims in progress</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Left col — Collections log + Claims */}
        <div className="space-y-4">
          {/* Payments received today */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">💳 Payments Received</div>
              <button onClick={() => setNewPayment(true)} className="text-[10px] text-blue-600 font-semibold hover:underline">+ Log</button>
            </div>
            <div className="divide-y divide-gray-50">
              {collections.map(p => (
                <div key={p.id} className="px-4 py-2.5">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-[12px] font-bold text-gray-900">{p.client}</div>
                      <div className="text-[10px] text-gray-400">{p.method} · {p.ref} · Order #{p.order}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[13px] font-extrabold text-emerald-600">${p.amount.toLocaleString()}</div>
                      <div className="text-[9px] text-gray-400">{p.time}</div>
                    </div>
                  </div>
                </div>
              ))}
              {collections.length === 0 && (
                <div className="p-4 text-[12px] text-gray-400 text-center">No payments logged today</div>
              )}
            </div>
            <div className="px-4 py-2 border-t border-gray-100 flex justify-between text-[11px]">
              <span className="text-gray-500">Today's total</span>
              <span className="font-extrabold text-emerald-600">${collections.reduce((s,p) => s + p.amount, 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Claims */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">🛡️ Insurance Claims</div>
              <a href="/claims" className="text-[10px] text-blue-600 font-semibold hover:underline">View all →</a>
            </div>
            <div className="divide-y divide-gray-50">
              {MOCK_CLAIMS.map(c => (
                <div key={c.id} className="px-4 py-2.5">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-[12px] font-bold text-gray-900">{c.vehicle} · {c.issue}</div>
                      <div className="text-[10px] text-gray-400">{c.client} · {c.daysOpen}d open</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[12px] font-bold text-gray-900">${c.amount.toLocaleString()}</div>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                        c.status === 'New' ? 'bg-red-50 text-red-600' :
                        c.status === 'Submitted' ? 'bg-blue-50 text-blue-600' :
                        'bg-amber-50 text-amber-600'
                      }`}>{c.status}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-gray-100 flex justify-between text-[11px]">
              <span className="text-gray-500">Total exposure</span>
              <span className="font-extrabold text-purple-600">${claimsTotal.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Right 2 cols — Outstanding + Overdue */}
        <div className="col-span-2 space-y-4">
          {/* Overdue */}
          {overdue.length > 0 && (
            <div className="bg-white rounded-xl border border-red-200">
              <div className="px-4 py-3 border-b border-red-100 flex justify-between items-center">
                <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider">⚠️ Overdue Invoices</div>
                <span className="text-[11px] font-bold text-red-600">${totalOverdue.toLocaleString()}</span>
              </div>
              <div className="divide-y divide-red-50">
                {overdue.slice(0, 6).map(o => {
                  const daysLate = Math.round((new Date().getTime() - new Date(o.endDate + 'T12:00:00').getTime()) / 86400000);
                  return (
                    <div key={o.orderId} className="px-4 py-2.5 flex justify-between items-center hover:bg-red-50">
                      <div className="flex-1 min-w-0 mr-3">
                        <div className="text-[12px] font-bold text-gray-900 truncate">{o.customer}</div>
                        <div className="text-[10px] text-gray-500 truncate">{o.description} · #{o.orderNumber}</div>
                        <div className="text-[9px] text-gray-400">{o.agent} · ended {fDate(o.endDate)}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[13px] font-extrabold text-red-600">${o.balance.toLocaleString()}</div>
                        <div className="text-[9px] text-red-400 font-semibold">{daysLate}d overdue</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Outstanding balances */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Outstanding Balances · Live from RentalWorks</div>
              <span className="text-[11px] font-bold text-amber-600">${totalOutstanding.toLocaleString()}</span>
            </div>
            {loading && <div className="p-4 text-[12px] text-gray-400 text-center">Loading from RentalWorks...</div>}
            <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
              {outstanding.slice(0, 20).map(o => (
                <div key={o.orderId} className="px-4 py-2.5 flex justify-between items-center hover:bg-gray-50">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="text-[12px] font-bold text-gray-900 truncate">{o.customer}</div>
                    <div className="text-[10px] text-gray-500 truncate">{o.description} · #{o.orderNumber}</div>
                    <div className="text-[9px] text-gray-400 flex gap-2">
                      <span>{o.agent}</span>
                      {o.poNumber && <span>· PO: {o.poNumber}</span>}
                      {o.ccAuthStatus && <span>· CC: {o.ccAuthStatus}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[13px] font-extrabold text-amber-600">${o.balance.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400">of ${o.total.toLocaleString()}</div>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                      o.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' :
                      o.status === 'COMPLETE' ? 'bg-gray-100 text-gray-500' :
                      'bg-blue-50 text-blue-700'
                    }`}>{o.status}</span>
                  </div>
                </div>
              ))}
              {outstanding.length === 0 && !loading && (
                <div className="p-4 text-[12px] text-gray-400 text-center">All invoices collected 🎉</div>
              )}
            </div>
            {outstanding.length > 20 && (
              <div className="px-4 py-2 border-t border-gray-100 text-center">
                <span className="text-[11px] text-gray-400">Showing 20 of {outstanding.length} outstanding orders</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Log Payment Modal */}
      {newPayment && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setNewPayment(false)}>
          <div className="bg-white rounded-2xl w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-[16px] font-bold text-gray-900">Log Payment</h2>
                <p className="text-[11px] text-gray-400">Record a CardPointe or manual payment</p>
              </div>
              <button onClick={() => setNewPayment(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Client Name</div>
                  <input value={pClient} onChange={e => setPClient(e.target.value)} placeholder="e.g. Echobend Pictures"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Amount</div>
                  <input value={pAmount} onChange={e => setPAmount(e.target.value)} placeholder="0.00" type="number"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Method</div>
                  <select value={pMethod} onChange={e => setPMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400">
                    <option>Visa</option><option>Amex</option><option>Mastercard</option>
                    <option>ACH</option><option>Check</option><option>Wire</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">CardPointe Ref #</div>
                  <input value={pRef} onChange={e => setPRef(e.target.value)} placeholder="CP-XXXXX"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Order # (RW)</div>
                  <input value={pOrder} onChange={e => setPOrder(e.target.value)} placeholder="302849"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-gray-400" />
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-2">
              <button onClick={() => setNewPayment(false)} className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-600 text-[13px] font-semibold">Cancel</button>
              <button onClick={logPayment} disabled={!pClient || !pAmount}
                className={`flex-1 py-2.5 rounded-lg text-[13px] font-bold ${pClient && pAmount ? 'bg-black text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                Log Payment ✓
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-3 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
