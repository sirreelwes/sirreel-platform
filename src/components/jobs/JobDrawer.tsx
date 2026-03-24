'use client';
import { useEffect, useState } from 'react';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  ACTIVE:    { label: 'Active',    color: 'text-emerald-700', bg: 'bg-emerald-50' },
  CONFIRMED: { label: 'Confirmed', color: 'text-blue-700',    bg: 'bg-blue-50'    },
  COMPLETE:  { label: 'Complete',  color: 'text-gray-500',    bg: 'bg-gray-50'    },
  CANCELLED: { label: 'Cancelled', color: 'text-red-600',     bg: 'bg-red-50'     },
  CLOSED:    { label: 'Closed',    color: 'text-gray-400',    bg: 'bg-gray-50'    },
};

function fDate(ds: string) {
  if (!ds) return '';
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type Props = { orderId: string | null; orderNumber: string; onClose: () => void; };

export default function JobDrawer({ orderId, orderNumber, onClose }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId) return;
    setLoading(true); setData(null); setError('');
    fetch(`/api/rentalworks/order?id=${orderId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError('Failed to load order details.'); setLoading(false); });
  }, [orderId]);

  const lineItems = (() => {
    if (!data?.items?.Rows || !data?.items?.ColumnIndex) return [];
    const cols = data.items.ColumnIndex;
    return data.items.Rows.map((r: any[]) => ({
      itemId:      r[cols.OrderItemId] ?? '',
      description: r[cols.Description] ?? r[cols.ItemDescription] ?? '',
      itemNumber:  r[cols.ItemNumber]  ?? r[cols.RentalItemId]   ?? '',
      qty:         r[cols.Quantity]    ?? r[cols.OrderedQty]     ?? '',
      amount:      Number(r[cols.Amount] ?? r[cols.Total]        ?? 0),
      startDate:   r[cols.StartDate]   ?? r[cols.EstimatedStartDate] ?? '',
      endDate:     r[cols.StopDate]    ?? r[cols.EstimatedStopDate]  ?? '',
      category:    r[cols.Category]    ?? r[cols.ItemCategory]   ?? '',
    }));
  })();

  const order = data?.order;
  const status = order?.Status ?? '';
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.CLOSED;
  if (!orderId) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 w-[520px] max-w-[95vw] bg-white shadow-2xl flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[15px] font-extrabold text-gray-900">Order #{orderNumber}</span>
              {status && <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${cfg.color} ${cfg.bg}`}>{cfg.label}</span>}
            </div>
            {order?.Customer && <p className="text-[12px] text-gray-500">{order.Customer}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl p-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mb-3" />
              <span className="text-[12px]">Loading from RentalWorks...</span>
            </div>
          )}
          {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">{error}</div>}

          {!loading && order && (
            <>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Order Details</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {[
                    ['Customer',   order.Customer],
                    ['Agent',      order.CustomerServiceRepresentative ? order.CustomerServiceRepresentative.split(',').reverse().join(' ').trim() : ''],
                    ['Start Date', fDate(order.EstimatedStartDate)],
                    ['End Date',   fDate(order.EstimatedStopDate)],
                    ['PO Number',  order.PoNumber],
                    ['Department', order.Department],
                    ['Deal Type',  order.DealType],
                    ['Market',     order.MarketType],
                  ].filter(([, v]) => v).map(([label, val]) => (
                    <div key={label}>
                      <div className="text-[9px] text-gray-400 uppercase font-semibold">{label}</div>
                      <div className="text-[12px] text-gray-800 font-medium">{val}</div>
                    </div>
                  ))}
                </div>
              </div>
              {order.Description && (
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Description</div>
                  <p className="text-[12px] text-gray-700">{order.Description}</p>
                </div>
              )}
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex justify-between items-center">
                <span className="text-[12px] text-gray-500 font-medium">Order Total</span>
                <span className="text-[20px] font-extrabold text-gray-900">${Number(order.Total || 0).toLocaleString()}</span>
              </div>
            </>
          )}

          {!loading && lineItems.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Line Items ({lineItems.length})</div>
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-3 py-2 text-[9px] font-bold text-gray-400 uppercase">Item</th>
                      <th className="text-center px-2 py-2 text-[9px] font-bold text-gray-400 uppercase">Qty</th>
                      <th className="text-right px-3 py-2 text-[9px] font-bold text-gray-400 uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item: any, i: number) => (
                      <tr key={item.itemId || i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800">{item.description || item.itemNumber || '—'}</div>
                          {item.category && <div className="text-[9px] text-gray-400">{item.category}</div>}
                          {item.startDate && <div className="text-[9px] text-gray-400">{fDate(item.startDate)}{item.endDate ? ` – ${fDate(item.endDate)}` : ''}</div>}
                        </td>
                        <td className="px-2 py-2 text-center text-gray-600">{item.qty}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800">
                          {item.amount ? `$${Number(item.amount).toLocaleString()}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={2} className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase">Total</td>
                      <td className="px-3 py-2 text-right font-extrabold text-gray-900">
                        ${lineItems.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
          {!loading && data && lineItems.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-[12px]">No line items found</div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <a href={`https://sirreel.rentalworks.cloud/order/${orderId}`} target="_blank" rel="noopener noreferrer"
            className="flex-1 py-2.5 rounded-lg bg-black text-white text-[12px] font-bold text-center hover:bg-gray-800 transition-colors">
            Open in RentalWorks ↗
          </a>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg bg-gray-100 text-gray-600 text-[12px] font-semibold hover:bg-gray-200">Close</button>
        </div>
      </div>
    </>
  );
}
