'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  booked: 'bg-blue-100 text-blue-700',
  hold: 'bg-amber-100 text-amber-700',
  quoted: 'bg-purple-100 text-purple-700',
  inquiry: 'bg-sky-100 text-sky-700',
  complete: 'bg-gray-100 text-gray-600',
};

function fmt(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const id = params?.id as string;

  const [job, setJob] = useState<any>(null);
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assets, setAssets] = useState<any[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null); // bookingItemId
  const [selectedAsset, setSelectedAsset] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const role = (session?.user as any)?.role;
  const canAssign = ['ADMIN', 'SALES'].includes(role);

  useEffect(() => {
    // Fetch job from RW timeline API
    fetch('/api/timeline')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          const found = d.jobs?.find((j: any) => j.id === id || j.orderNumber === id);
          if (found) setJob(found);
        }
      });

    // Fetch booking from our DB by RW order ID
    fetch(`/api/bookings/by-rw-order?orderId=${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.booking) setBooking(d.booking);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Fetch available assets
    fetch('/api/timeline/assets')
      .then(r => r.json())
      .then(d => { if (d.ok) setAssets(d.assets || []); });
  }, [id]);

  const assignAsset = async (bookingItemId: string) => {
    if (!selectedAsset) return;
    setSaving(true);
    try {
      const res = await fetch('/api/bookings/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingItemId, assetId: selectedAsset }),
      });
      if (res.ok) {
        // Refresh booking
        const d = await fetch(`/api/bookings/by-rw-order?orderId=${id}`).then(r => r.json());
        if (d.booking) setBooking(d.booking);
        setAssigning(null);
        setSelectedAsset('');
      }
    } finally { setSaving(false); }
  };

  const removeAssignment = async (assignmentId: string) => {
    setSaving(true);
    try {
      await fetch(`/api/bookings/assign/${assignmentId}`, { method: 'DELETE' });
      const d = await fetch(`/api/bookings/by-rw-order?orderId=${id}`).then(r => r.json());
      if (d.booking) setBooking(d.booking);
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>;

  if (!job && !booking) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="text-4xl">🔍</div>
      <div className="text-gray-600 font-semibold">Job not found</div>
      <button onClick={() => router.back()} className="text-sm text-blue-600 hover:underline">← Go back</button>
    </div>
  );

  const statusColor = STATUS_COLORS[job?.status] || 'bg-gray-100 text-gray-600';
  const items = booking?.items || [];
  const paperwork = booking?.paperworkRequests?.[0];

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-10">
      {/* Back */}
      <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1">
        ← Back
      </button>

      {/* Header */}
      <div className="bg-gray-900 rounded-2xl p-6 text-white">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Job</div>
            <h1 className="text-2xl font-bold">{job?.company || booking?.company?.name}</h1>
            <div className="text-gray-400 mt-0.5">{job?.jobName || booking?.jobName}</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${statusColor}`}>
              {(job?.status || booking?.status || '').toUpperCase()}
            </span>
            <div className="text-[11px] text-gray-400">#{job?.orderNumber || booking?.bookingNumber}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">Start</div>
            <div className="text-sm font-semibold">{fmt(job?.startDate || booking?.startDate)}</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">End</div>
            <div className="text-sm font-semibold">{fmt(job?.endDate || booking?.endDate)}</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">Agent</div>
            <div className="text-sm font-semibold">{job?.agent || booking?.agent?.name}</div>
          </div>
        </div>
      </div>

      {/* Vehicle Assignments */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Vehicle Assignments</div>
          {!canAssign && <span className="text-[10px] text-gray-400">View only</span>}
        </div>

        {items.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            <div className="text-3xl mb-2">🚛</div>
            No booking items found in Fleet HQ.
            <div className="text-xs mt-1">This job may only exist in RentalWorks.</div>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item: any) => {
              const assigned = item.assignments || [];
              const needed = item.quantity - assigned.length;
              const catAssets = assets.filter(a =>
                a.categoryId === item.categoryId &&
                !assigned.find((ax: any) => ax.assetId === a.id)
              );

              return (
                <div key={item.id} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-bold text-gray-900">{item.category?.name}</div>
                      <div className="text-[11px] text-gray-400">{item.quantity} requested · {assigned.length} assigned</div>
                    </div>
                    {needed > 0 && (
                      <span className="text-[10px] font-bold px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg">
                        {needed} unassigned
                      </span>
                    )}
                    {needed <= 0 && (
                      <span className="text-[10px] font-bold px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg">
                        ✓ Fully assigned
                      </span>
                    )}
                  </div>

                  {/* Assigned units */}
                  <div className="space-y-1.5 mb-3">
                    {assigned.map((a: any) => (
                      <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-500 text-sm">✓</span>
                          <span className="text-sm font-semibold text-gray-900">{a.asset?.unitName}</span>
                          <span className="text-[10px] text-gray-400">{a.asset?.year} {a.asset?.make}</span>
                        </div>
                        {canAssign && (
                          <button onClick={() => removeAssignment(a.id)} className="text-[10px] text-red-400 hover:text-red-600 font-semibold">
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Assign new unit */}
                  {canAssign && needed > 0 && (
                    assigning === item.id ? (
                      <div className="flex gap-2">
                        <select value={selectedAsset} onChange={e => setSelectedAsset(e.target.value)}
                          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400">
                          <option value="">Select a unit...</option>
                          {catAssets.map((a: any) => (
                            <option key={a.id} value={a.id}>{a.unitName} · {a.year} {a.make}</option>
                          ))}
                        </select>
                        <button onClick={() => assignAsset(item.id)} disabled={!selectedAsset || saving}
                          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-40">
                          {saving ? '...' : 'Assign'}
                        </button>
                        <button onClick={() => { setAssigning(null); setSelectedAsset(''); }}
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-500">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setAssigning(item.id)}
                        className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors">
                        + Assign a unit
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Paperwork Status */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Paperwork</div>
        {!paperwork ? (
          <div className="text-sm text-gray-400">No paperwork request sent yet.</div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Rental Agreement', done: paperwork.rentalAgreement },
              { label: 'LCDW', done: paperwork.lcdwAccepted },
              { label: 'COI', done: paperwork.coiReceived },
              { label: 'CC Auth', done: paperwork.creditCardAuth },
            ].map(item => (
              <div key={item.label} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${item.done ? 'bg-emerald-50 border-emerald-100' : 'bg-gray-50 border-gray-100'}`}>
                <span className={item.done ? 'text-emerald-500' : 'text-gray-300'}>
                  {item.done ? '✓' : '○'}
                </span>
                <span className={`text-sm font-medium ${item.done ? 'text-emerald-700' : 'text-gray-500'}`}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        )}
        {paperwork?.creditCardAuth && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <div className="text-[10px] font-bold text-blue-400 uppercase mb-1">CC Auth on File</div>
            <div className="text-sm text-blue-800 font-semibold">
              {paperwork.ccCardholderFirst} {paperwork.ccCardholderLast} · {paperwork.ccCardType} ···· {paperwork.ccCardLast4}
            </div>
            {paperwork.ccChargeEstimate && (
              <div className="text-[11px] text-blue-600 mt-0.5">Est. charge: ${paperwork.ccChargeEstimate}</div>
            )}
          </div>
        )}
      </div>

      {/* Delivery */}
      {(booking?.deliveryAddress || booking?.pickupAddress) && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Logistics</div>
          <div className="space-y-2 text-sm">
            {booking.deliveryAddress && (
              <div className="flex gap-2"><span className="text-gray-400">📍 Delivery:</span><span className="text-gray-700">{booking.deliveryAddress}{booking.deliveryTime ? ` · ${booking.deliveryTime}` : ''}</span></div>
            )}
            {booking.pickupAddress && (
              <div className="flex gap-2"><span className="text-gray-400">🔄 Pickup:</span><span className="text-gray-700">{booking.pickupAddress}{booking.pickupTime ? ` · ${booking.pickupTime}` : ''}</span></div>
            )}
          </div>
        </div>
      )}

      {/* Notes */}
      {booking?.notes && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Notes</div>
          <p className="text-sm text-gray-600 leading-relaxed">{booking.notes}</p>
        </div>
      )}
    </div>
  );
}
