'use client';
import PaperworkTab from '@/components/jobs/PaperworkTab';
import { useEffect, useState } from 'react';

// ─── Role config ─────────────────────────────────────────────────────────────
const ROLE_SECTIONS: Record<string, string[]> = {
  ADMIN:      ['overview', 'paperwork', 'vehicles', 'client', 'financials', 'dispatch', 'warehouse', 'damage', 'notes'],
  SALES:      ['overview', 'paperwork', 'client', 'financials', 'vehicles', 'notes'],
  FLEET:      ['overview', 'vehicles', 'paperwork', 'dispatch', 'damage'],
  WAREHOUSE:  ['overview', 'vehicles', 'warehouse', 'dispatch'],
  COLLECTIONS:['overview', 'financials', 'paperwork', 'client'],
};

const SECTION_META: Record<string, { label: string; icon: string }> = {
  overview:   { label: 'Overview',    icon: '📋' },
  paperwork:  { label: 'Paperwork',   icon: '📝' },
  vehicles:   { label: 'Vehicles',    icon: '🚛' },
  client:     { label: 'Client',      icon: '👤' },
  financials: { label: 'Financials',  icon: '💰' },
  dispatch:   { label: 'Dispatch',    icon: '📍' },
  warehouse:  { label: 'Warehouse',   icon: '📦' },
  damage:     { label: 'Damage/Ins',  icon: '🔧' },
  notes:      { label: 'Notes',       icon: '💬' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  ACTIVE:    { label: 'Active',    color: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500' },
  CONFIRMED: { label: 'Confirmed', color: 'text-blue-700',    bg: 'bg-blue-50',    dot: 'bg-blue-500'    },
  COMPLETE:  { label: 'Complete',  color: 'text-gray-500',    bg: 'bg-gray-50',    dot: 'bg-gray-400'    },
  CANCELLED: { label: 'Cancelled', color: 'text-red-600',     bg: 'bg-red-50',     dot: 'bg-red-500'     },
  CLOSED:    { label: 'Closed',    color: 'text-gray-400',    bg: 'bg-gray-50',    dot: 'bg-gray-300'    },
  REQUEST:   { label: 'Request',   color: 'text-amber-700',   bg: 'bg-amber-50',   dot: 'bg-amber-500'   },
};

function fDate(ds: string) {
  if (!ds) return '—';
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fShort(ds: string) {
  if (!ds) return '—';
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type Props = {
  orderId: string | null;
  orderNumber: string;
  onClose: () => void;
  userRole?: string;
  userName?: string;
};

export default function JobDashboard({ orderId, orderNumber, onClose, userRole, userName }: Props) {
  const [rwData, setRwData] = useState<any>(null);
  const [dbData, setDbData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');
  const [savingNote, setSavingNote] = useState(false);
  const [newNote, setNewNote] = useState('');

  // Determine role
  const role = (() => {
    if (userRole) return userRole;
    try {
      const r = localStorage.getItem('sirreel_demo_role') || '';
      const n = localStorage.getItem('sirreel_demo_name') || '';
      if (n.includes('Julian')) return 'FLEET';
      if (n.includes('Ana')) return 'COLLECTIONS';
      if (n.includes('Jose') || n.includes('Oliver')) return 'SALES';
      if (r === 'ADMIN') return 'ADMIN';
      return 'ADMIN';
    } catch { return 'ADMIN'; }
  })();

  const sections = ROLE_SECTIONS[role] || ROLE_SECTIONS.ADMIN;

  useEffect(() => {
    if (!orderId) return;
    setLoading(true); setRwData(null); setDbData(null);
    setActiveSection('overview');

    // Load RentalWorks order
    fetch(`/api/rentalworks/order?id=${orderId}`)
      .then(r => r.json())
      .then(d => setRwData(d))
      .catch(() => {})
      .finally(() => setLoading(false));

    // Load DB booking by RW order ID
    fetch(`/api/bookings/by-rw-order?orderId=${orderId}`)
      .then(r => r.json())
      .then(d => setDbData(d.booking || null))
      .catch(() => {});
  }, [orderId]);

  if (!orderId) return null;

  const order = rwData?.order;
  const status = order?.Status ?? dbData?.status ?? '';
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.CLOSED;

  const lineItems = (() => {
    if (!rwData?.items?.Rows || !rwData?.items?.ColumnIndex) return [];
    const cols = rwData.items.ColumnIndex;
    return rwData.items.Rows.map((r: any[]) => ({
      itemId:      r[cols.OrderItemId] ?? '',
      description: r[cols.Description] ?? r[cols.ItemDescription] ?? '',
      itemNumber:  r[cols.ItemNumber] ?? '',
      qty:         r[cols.Quantity] ?? r[cols.OrderedQty] ?? '',
      amount:      Number(r[cols.Amount] ?? r[cols.Total] ?? 0),
      startDate:   r[cols.StartDate] ?? r[cols.EstimatedStartDate] ?? '',
      endDate:     r[cols.StopDate] ?? r[cols.EstimatedStopDate] ?? '',
      category:    r[cols.Category] ?? r[cols.ItemCategory] ?? '',
    }));
  })();

  const totalAmount = lineItems.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 w-[640px] max-w-[96vw] bg-white shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-100">
          <div className="flex items-start justify-between px-5 pt-4 pb-3">
            <div className="flex items-center gap-3 min-w-0">
              {status && (
                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg ${cfg.bg} flex-shrink-0`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  <span className={`text-[10px] font-bold ${cfg.color}`}>{cfg.label}</span>
                </div>
              )}
              <div className="min-w-0">
                <div className="text-[15px] font-extrabold text-gray-900 truncate">
                  {order?.Customer || order?.Description || `Order #${orderNumber}`}
                </div>
                <div className="text-[11px] text-gray-400 font-mono">
                  #{orderNumber}
                  {order?.PoNumber && ` · PO: ${order.PoNumber}`}
                  {dbData?.bookingNumber && ` · ${dbData.bookingNumber}`}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="ml-3 flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 text-sm transition-colors">✕</button>
          </div>

          {/* Role badge + dates strip */}
          <div className="px-5 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              {order?.EstimatedStartDate && (
                <span className="flex items-center gap-1">
                  <span className="text-gray-300">📅</span>
                  {fShort(order.EstimatedStartDate)} – {fShort(order.EstimatedStopDate)}
                </span>
              )}
              {order?.CustomerServiceRepresentative && (
                <span className="flex items-center gap-1">
                  <span className="text-gray-300">👤</span>
                  {order.CustomerServiceRepresentative.split(',').reverse().join(' ').trim()}
                </span>
              )}
            </div>
            <div className={`text-[9px] font-bold px-2 py-0.5 rounded-md ${
              role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
              role === 'SALES' ? 'bg-blue-100 text-blue-700' :
              role === 'FLEET' ? 'bg-emerald-100 text-emerald-700' :
              role === 'WAREHOUSE' ? 'bg-orange-100 text-orange-700' :
              'bg-gray-100 text-gray-600'
            }`}>{role}</div>
          </div>

          {/* Section tabs */}
          <div className="flex overflow-x-auto border-t border-gray-100 px-5 gap-0 scrollbar-hide">
            {sections.map(sec => {
              const meta = SECTION_META[sec];
              return (
                <button
                  key={sec}
                  onClick={() => setActiveSection(sec)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-colors ${
                    activeSection === sec
                      ? 'border-gray-900 text-gray-900'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <span>{meta.icon}</span>
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin mb-3" />
              <span className="text-[12px]">Loading from RentalWorks...</span>
            </div>
          ) : (
            <div className="p-5 space-y-4">

              {/* ── OVERVIEW ── */}
              {activeSection === 'overview' && (
                <>
                  {/* Key metrics */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Order Total</div>
                      <div className="text-lg font-extrabold text-gray-900">${(Number(order?.Total || totalAmount)).toLocaleString()}</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Duration</div>
                      <div className="text-lg font-extrabold text-gray-900">
                        {order?.EstimatedStartDate && order?.EstimatedStopDate
                          ? Math.max(1, Math.round((new Date(order.EstimatedStopDate).getTime() - new Date(order.EstimatedStartDate).getTime()) / 86400000) + 1) + 'd'
                          : '—'}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Items</div>
                      <div className="text-lg font-extrabold text-gray-900">{lineItems.length}</div>
                    </div>
                  </div>

                  {/* Order details grid */}
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-3">Order Details</div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        ['Customer', order?.Customer],
                        ['Agent', order?.CustomerServiceRepresentative?.split(',').reverse().join(' ').trim()],
                        ['Start', fDate(order?.EstimatedStartDate)],
                        ['End', fDate(order?.EstimatedStopDate)],
                        ['PO Number', order?.PoNumber],
                        ['Department', order?.Department],
                        ['Deal Type', order?.DealType],
                        ['Market', order?.MarketType],
                      ].filter(([, v]) => v).map(([label, val]) => (
                        <div key={label as string}>
                          <div className="text-[9px] text-gray-400 uppercase font-bold">{label}</div>
                          <div className="text-[12px] text-gray-800 font-semibold">{val}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Description */}
                  {order?.Description && (
                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                      <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Description</div>
                      <p className="text-[12px] text-gray-700 leading-relaxed">{order.Description}</p>
                    </div>
                  )}

                  {/* Paperwork quick status */}
                  {dbData && (
                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                      <div className="text-[10px] font-bold text-gray-400 uppercase mb-3">Paperwork Status</div>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { label: 'Rental Agreement', done: dbData.rentalAgreement },
                          { label: 'COI', done: dbData.coiReceived },
                          { label: 'CC Auth', done: dbData.paperworkRequests?.[0]?.creditCardAuth },
                        ].map(item => (
                          <div key={item.label} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                            item.done ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                          }`}>
                            <span>{item.done ? '✓' : '✗'}</span>
                            {item.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── PAPERWORK ── */}
              {/* ── PAPERWORK ── */}
              {activeSection === 'paperwork' && (
                <PaperworkTab
                  booking={dbData}
                  token={dbData?.paperworkRequests?.[0]?.token}
                />
              )}


              {/* ── VEHICLES ── */}
              {activeSection === 'vehicles' && (
                <>
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-3">Line Items / Vehicles</div>
                    {lineItems.length > 0 ? (
                      <div className="space-y-2">
                        {lineItems.map((item: any, i: number) => (
                          <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                            <div className="w-8 h-8 bg-white border border-gray-200 rounded-lg flex items-center justify-center text-base flex-shrink-0">
                              {item.description?.toLowerCase().includes('cube') ? '🚛' :
                               item.description?.toLowerCase().includes('van') ? '🚐' :
                               item.description?.toLowerCase().includes('studio') ? '🏢' :
                               item.description?.toLowerCase().includes('pop') ? '🎬' : '🚗'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] font-semibold text-gray-900 truncate">{item.description || item.itemNumber}</div>
                              {item.category && <div className="text-[10px] text-gray-400">{item.category}</div>}
                              {item.startDate && (
                                <div className="text-[10px] text-gray-400">{fShort(item.startDate)}{item.endDate ? ` – ${fShort(item.endDate)}` : ''}</div>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-[12px] font-bold text-gray-900">{item.qty > 1 ? `×${item.qty}` : ''}</div>
                              {item.amount > 0 && <div className="text-[11px] text-gray-500">${Number(item.amount).toLocaleString()}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[12px] text-gray-400 py-3">No line items</div>
                    )}
                  </div>

                  {/* DB assigned assets */}
                  {dbData?.items?.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                      <div className="text-[10px] font-bold text-gray-400 uppercase mb-3">Assigned Units</div>
                      <div className="space-y-2">
                        {dbData.items.map((item: any) => (
                          item.assignments?.map((a: any) => (
                            <div key={a.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                              <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center text-white text-[11px] font-bold">
                                {a.asset?.unitName || '?'}
                              </div>
                              <div className="flex-1">
                                <div className="text-[12px] font-semibold text-gray-900">{item.category?.name} #{a.asset?.unitName}</div>
                                <div className="text-[10px] text-gray-400">{a.asset?.licensePlate || a.asset?.vin || 'No plate/VIN'}</div>
                              </div>
                              <div className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                a.status === 'CHECKED_OUT' ? 'bg-emerald-100 text-emerald-700' :
                                a.status === 'RETURNED' ? 'bg-gray-100 text-gray-500' :
                                'bg-blue-100 text-blue-700'
                              }`}>{a.status}</div>
                            </div>
                          ))
                        ))}
                      </div>
                    </div>
                  )}

                  {/* DOT docs — Fleet role sees this */}
                  {(role === 'FLEET' || role === 'ADMIN') && dbData?.items?.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                      <div className="text-[10px] font-bold text-gray-400 uppercase mb-3">DOT Documents</div>
                      <div className="text-[12px] text-gray-500 mb-3">Per-vehicle docs for assigned units:</div>
                      {dbData.items.map((item: any) =>
                        item.assignments?.map((a: any) => a.asset && (
                          <div key={a.id} className="mb-3 last:mb-0">
                            <div className="text-[11px] font-bold text-gray-700 mb-1.5">{item.category?.name} #{a.asset.unitName}</div>
                            <div className="grid grid-cols-3 gap-1.5">
                              {['Registration', 'Insurance Card', 'BIT', 'Inspection'].map(doc => (
                                <div key={doc} className="flex items-center gap-1.5 p-2 bg-gray-50 rounded-lg">
                                  <span className="text-[10px]">{
                                    doc === 'Registration' ? '📋' :
                                    doc === 'Insurance Card' ? '🛡️' :
                                    doc === 'BIT' ? '🔍' : '🔧'
                                  }</span>
                                  <span className="text-[9px] text-gray-500">{doc}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                      <a href="/fleet/docs" target="_blank" className="mt-2 block text-center py-2 border border-gray-200 rounded-xl text-[11px] text-gray-600 font-semibold hover:bg-gray-50 transition-colors">
                        Manage Fleet Docs →
                      </a>
                    </div>
                  )}
                </>
              )}

              {/* ── CLIENT ── */}
              {activeSection === 'client' && (
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-3">Client Information</div>
                  <div className="space-y-3">
                    {order?.Customer && (
                      <div className="p-3 bg-gray-50 rounded-xl">
                        <div className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">Company</div>
                        <div className="text-[13px] font-bold text-gray-900">{order.Customer}</div>
                      </div>
                    )}
                    {dbData?.person && (
                      <div className="p-3 bg-gray-50 rounded-xl">
                        <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">Primary Contact</div>
                        <div className="text-[12px] font-semibold text-gray-900">{dbData.person.name}</div>
                        {dbData.person.email && (
                          <a href={`mailto:${dbData.person.email}`} className="text-[11px] text-blue-600 hover:underline block">{dbData.person.email}</a>
                        )}
                        {dbData.person.phone && (
                          <a href={`tel:${dbData.person.phone}`} className="text-[11px] text-gray-500 hover:underline block">{dbData.person.phone}</a>
                        )}
                      </div>
                    )}
                    {dbData?.paperworkRequests?.[0]?.signerName && (
                      <div className="p-3 bg-gray-50 rounded-xl">
                        <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">Agreement Signer</div>
                        <div className="text-[12px] font-semibold text-gray-900">{dbData.paperworkRequests[0].signerName}</div>
                        <div className="text-[11px] text-gray-500">{dbData.paperworkRequests[0].signerTitle}</div>
                        <div className="text-[11px] text-gray-500">{dbData.paperworkRequests[0].signerEmail}</div>
                        <div className="text-[11px] text-gray-500">{dbData.paperworkRequests[0].signerPhone}</div>
                      </div>
                    )}
                    {/* Portal link for sending */}
                    {dbData?.paperworkRequests?.[0] && (
                      <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
                        <div className="text-[10px] font-bold text-blue-600 uppercase mb-2">Client Portal Link</div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/client/${dbData.paperworkRequests[0].token}`)}
                            className="flex-1 py-2 bg-blue-600 text-white text-[11px] font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            Copy Dashboard Link
                          </button>
                          <button
                            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/${dbData.paperworkRequests[0].token}`)}
                            className="flex-1 py-2 bg-white border border-blue-200 text-blue-700 text-[11px] font-semibold rounded-lg hover:bg-blue-50 transition-colors"
                          >
                            Copy Paperwork Link
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── FINANCIALS ── */}
              {activeSection === 'financials' && (
                <>
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-3">Financial Summary</div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center py-2 border-b border-gray-100">
                        <span className="text-[12px] text-gray-600">Order Total</span>
                        <span className="text-[14px] font-extrabold text-gray-900">${Number(order?.Total || totalAmount).toLocaleString()}</span>
                      </div>
                      {dbData?.depositAmount && (
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                          <span className="text-[12px] text-gray-600">Deposit Required</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold text-gray-900">${Number(dbData.depositAmount).toLocaleString()}</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${dbData.depositPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                              {dbData.depositPaid ? 'PAID' : 'UNPAID'}
                            </span>
                          </div>
                        </div>
                      )}
                      {dbData?.invoiceStatus && (
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                          <span className="text-[12px] text-gray-600">Invoice Status</span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${
                            dbData.invoiceStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                            dbData.invoiceStatus === 'sent' ? 'bg-blue-100 text-blue-700' :
                            dbData.invoiceStatus === 'overdue' ? 'bg-red-100 text-red-600' :
                            'bg-gray-100 text-gray-500'
                          }`}>{dbData.invoiceStatus?.toUpperCase() || 'NOT CREATED'}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Line items */}
                  {lineItems.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Line Items</div>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="text-left px-4 py-2 text-[9px] font-bold text-gray-400 uppercase">Item</th>
                            <th className="text-center px-2 py-2 text-[9px] font-bold text-gray-400 uppercase">Qty</th>
                            <th className="text-right px-4 py-2 text-[9px] font-bold text-gray-400 uppercase">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lineItems.map((item: any, i: number) => (
                            <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-gray-800">{item.description || item.itemNumber || '—'}</div>
                                {item.category && <div className="text-[9px] text-gray-400">{item.category}</div>}
                              </td>
                              <td className="px-2 py-2.5 text-center text-gray-600">{item.qty}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-gray-800">
                                {item.amount ? `$${Number(item.amount).toLocaleString()}` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-50 border-t border-gray-200">
                            <td colSpan={2} className="px-4 py-2.5 text-[10px] font-bold text-gray-500 uppercase">Total</td>
                            <td className="px-4 py-2.5 text-right font-extrabold text-gray-900">${totalAmount.toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  <a href={`https://sirreel.rentalworks.cloud/order/${orderNumber}`} target="_blank"
                    className="block text-center py-2.5 border border-gray-200 rounded-xl text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                    Open in RentalWorks ↗
                  </a>
                </>
              )}

              {/* ── DISPATCH ── */}
              {activeSection === 'dispatch' && (
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-3">Delivery & Pickup</div>
                  {dbData ? (
                    <div className="space-y-3">
                      {dbData.deliveryAddress && (
                        <div className="p-3 bg-gray-50 rounded-xl">
                          <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">📍 Delivery Address</div>
                          <div className="text-[12px] font-semibold text-gray-900">{dbData.deliveryAddress}</div>
                          {dbData.deliveryTime && <div className="text-[11px] text-gray-500 mt-0.5">Time: {dbData.deliveryTime}</div>}
                        </div>
                      )}
                      {dbData.pickupAddress && (
                        <div className="p-3 bg-gray-50 rounded-xl">
                          <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">🔁 Pickup Address</div>
                          <div className="text-[12px] font-semibold text-gray-900">{dbData.pickupAddress}</div>
                          {dbData.pickupTime && <div className="text-[11px] text-gray-500 mt-0.5">Time: {dbData.pickupTime}</div>}
                        </div>
                      )}
                      {!dbData.deliveryAddress && !dbData.pickupAddress && (
                        <div className="text-[12px] text-gray-400">No delivery/pickup info on file.</div>
                      )}
                      {/* Dispatch tasks */}
                      {dbData.dispatchTasks?.length > 0 && (
                        <div>
                          <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Dispatch Tasks</div>
                          <div className="space-y-1.5">
                            {dbData.dispatchTasks.map((task: any) => (
                              <div key={task.id} className={`flex items-center gap-2 p-2.5 rounded-lg border text-[11px] ${
                                task.status === 'COMPLETE' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' :
                                task.status === 'IN_PROGRESS' ? 'border-blue-100 bg-blue-50 text-blue-700' :
                                'border-gray-100 bg-gray-50 text-gray-600'
                              }`}>
                                <span>{task.status === 'COMPLETE' ? '✓' : task.status === 'IN_PROGRESS' ? '→' : '○'}</span>
                                <span className="font-medium">{task.taskType}</span>
                                {task.scheduledAt && <span className="ml-auto text-[9px] opacity-70">{fShort(task.scheduledAt)}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[12px] text-gray-400">No dispatch info — booking not yet in system.</div>
                  )}
                </div>
              )}

              {/* ── WAREHOUSE ── */}
              {activeSection === 'warehouse' && (
                <>
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-3">📦 Pick List</div>
                    {lineItems.length > 0 ? (
                      <div className="space-y-1.5">
                        {lineItems.map((item: any, i: number) => (
                          <div key={i} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-xl">
                            <div className="w-6 h-6 border-2 border-gray-300 rounded flex-shrink-0" />
                            <div className="flex-1">
                              <div className="text-[12px] font-semibold text-gray-900">{item.description || item.itemNumber}</div>
                              {item.startDate && <div className="text-[9px] text-gray-400">{fShort(item.startDate)}</div>}
                            </div>
                            <div className="text-[13px] font-extrabold text-gray-700 flex-shrink-0">×{item.qty || 1}</div>
                          </div>
                        ))}
                        <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-[11px]">
                          <span className="text-gray-500">Total items</span>
                          <span className="font-bold text-gray-900">{lineItems.reduce((s: number, i: any) => s + (Number(i.qty) || 1), 0)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[12px] text-gray-400">No items</div>
                    )}
                  </div>
                  {dbData?.deliveryAddress && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                      <div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Delivery</div>
                      <div className="text-[12px] text-amber-800 font-semibold">{dbData.deliveryAddress}</div>
                      {dbData.deliveryTime && <div className="text-[11px] text-amber-600">{dbData.deliveryTime}</div>}
                    </div>
                  )}
                </>
              )}

              {/* ── DAMAGE ── */}
              {activeSection === 'damage' && (
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-3">Damage ID & Insurance Claims</div>
                  {dbData?.insuranceClaims?.length > 0 ? (
                    <div className="space-y-2">
                      {dbData.insuranceClaims.map((claim: any) => (
                        <div key={claim.id} className="p-3 border border-red-100 bg-red-50 rounded-xl">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-[12px] font-bold text-red-800">Claim #{claim.claimNumber}</div>
                            <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              claim.status === 'OPEN' ? 'bg-red-200 text-red-700' :
                              claim.status === 'CLOSED' ? 'bg-gray-200 text-gray-600' :
                              'bg-amber-200 text-amber-700'
                            }`}>{claim.status}</div>
                          </div>
                          <div className="text-[11px] text-red-600">{claim.description}</div>
                          {claim.estimatedRepairCost && (
                            <div className="text-[11px] text-red-700 font-semibold mt-1">Est. Repair: ${Number(claim.estimatedRepairCost).toLocaleString()}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="text-3xl mb-2">✅</div>
                      <div className="text-[12px] text-gray-500">No damage claims on this order.</div>
                    </div>
                  )}
                  {dbData?.items?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Assigned Unit Damage IDs</div>
                      {dbData.items.map((item: any) =>
                        item.assignments?.map((a: any) => a.asset && (
                          <div key={a.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-[11px] mb-1">
                            <span className="font-bold text-gray-700">{item.category?.name} #{a.asset.unitName}</span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-500 font-mono">{a.asset.damageIdRef || 'No damage ID'}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── NOTES ── */}
              {activeSection === 'notes' && (
                <div className="space-y-3">
                  {dbData?.notes && (
                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                      <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Job Notes</div>
                      <p className="text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap">{dbData.notes}</p>
                    </div>
                  )}
                  {dbData?.adminNotes && (role === 'ADMIN') && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <div className="text-[10px] font-bold text-amber-600 uppercase mb-2">Admin Notes</div>
                      <p className="text-[12px] text-amber-800 leading-relaxed whitespace-pre-wrap">{dbData.adminNotes}</p>
                    </div>
                  )}
                  {!dbData?.notes && !dbData?.adminNotes && (
                    <div className="text-center py-6 text-gray-400 text-[12px]">No notes on this booking.</div>
                  )}
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Add Note</div>
                    <textarea
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl p-3 text-[12px] resize-none focus:outline-none focus:border-gray-400"
                      rows={3}
                      placeholder="Add a note..."
                    />
                    <button
                      disabled={!newNote.trim() || savingNote || !dbData}
                      className="mt-2 w-full py-2 bg-gray-900 text-white text-[12px] font-semibold rounded-xl hover:bg-gray-700 transition-colors disabled:opacity-40"
                    >
                      {savingNote ? 'Saving...' : 'Save Note'}
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 p-4 border-t border-gray-100 flex gap-2">
          <a
            href={`https://sirreel.rentalworks.cloud/order/${orderNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2.5 rounded-xl bg-gray-900 text-white text-[12px] font-bold text-center hover:bg-gray-700 transition-colors"
          >
            Open in RentalWorks ↗
          </a>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[12px] font-semibold hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
