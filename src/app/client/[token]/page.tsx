'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

// ─── Types ───────────────────────────────────────────────────────────────────
type PortalStep = 'agreement' | 'lcdw' | 'coi' | 'cc';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtShort = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

function getDaysInRange(start: string, end: string) {
  const days = [];
  const s = new Date(start);
  const e = new Date(end);
  const cur = new Date(s);
  while (cur <= e) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function MiniCalendar({ start, end, scheduleDays }: { start: string; end: string; scheduleDays?: any[] }) {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);

  // Build calendar for the month of start date
  const year = startDate.getFullYear();
  const month = startDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthName = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const isInRange = (day: number) => {
    const d = new Date(year, month, day);
    return d >= startDate && d <= endDate;
  };
  const isStart = (day: number) => new Date(year, month, day).toDateString() === startDate.toDateString();
  const isEnd = (day: number) => new Date(year, month, day).toDateString() === endDate.toDateString();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">{monthName}</div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className="text-center text-[9px] font-bold text-gray-400 pb-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const inRange = isInRange(day);
          const start_ = isStart(day);
          const end_ = isEnd(day);
          return (
            <div key={day} className={`
              text-center text-[11px] py-1 rounded-md font-medium transition-colors
              ${start_ || end_ ? 'bg-gray-900 text-white font-bold' : ''}
              ${inRange && !start_ && !end_ ? 'bg-gray-100 text-gray-700' : ''}
              ${!inRange ? 'text-gray-300' : ''}
            `}>
              {day}
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gray-900" />
          <span className="text-[10px] text-gray-500">Start/End</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gray-100" />
          <span className="text-[10px] text-gray-500">Rental Days</span>
        </div>
      </div>
    </div>
  );
}

function PaperworkModal({ step, token, onClose, onComplete }: { step: PortalStep; token: string; onClose: () => void; onComplete: (step: PortalStep) => void }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl z-10">
          <div className="text-sm font-bold text-gray-900">
            {step === 'agreement' && 'Rental Agreement'}
            {step === 'lcdw' && 'LCDW Waiver'}
            {step === 'coi' && 'Certificate of Insurance'}
            {step === 'cc' && 'Credit Card Authorization'}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors text-sm">✕</button>
        </div>
        <div className="p-5">
          <div className="text-sm text-gray-500 mb-4">
            {step === 'agreement' && 'Please read and sign the rental agreement to confirm your booking.'}
            {step === 'lcdw' && 'Acknowledge the Limited Collision Damage Waiver ($24/day/vehicle).'}
            {step === 'coi' && 'Upload your Certificate of Insurance naming SirReel as additional insured.'}
            {step === 'cc' && 'Authorize your credit card for rental charges and deposits.'}
          </div>
          <a
            href={`/portal/${token}`}
            target="_blank"
            className="block w-full bg-gray-900 text-white rounded-xl py-3.5 text-center font-semibold text-sm hover:bg-gray-800 transition-colors">
            Open Full Form →
          </a>
          <p className="text-center text-xs text-gray-400 mt-2">Opens in a new tab</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ClientDashboard() {
  const params = useParams();
  const token = params?.token as string;

  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<any>(null);
  const [paperwork, setPaperwork] = useState<any>(null);
  const [error, setError] = useState('');
  const [activeModal, setActiveModal] = useState<PortalStep | null>(null);

  useEffect(() => {
    fetch(`/api/portal/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setBooking(data.booking);
        setPaperwork(data.request);
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false));
  }, [token]);

  const handlePaperworkComplete = (step: PortalStep) => {
    setPaperwork((prev: any) => ({
      ...prev,
      rentalAgreement: step === 'agreement' ? true : prev?.rentalAgreement,
      coiReceived: step === 'coi' ? true : prev?.coiReceived,
      creditCardAuth: step === 'cc' ? true : prev?.creditCardAuth,
    }));
    setActiveModal(null);
  };

  if (loading) return (
    <div className="min-h-screen bg-[#F8F7F4] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
          <span className="text-white text-xs font-bold">SR</span>
        </div>
        <div className="text-gray-400 text-sm">Loading your dashboard...</div>
      </div>
    </div>
  );

  if (error || !booking) return (
    <div className="min-h-screen bg-[#F8F7F4] flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="w-12 h-12 bg-gray-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-gray-500 text-xl">🔒</span>
        </div>
        <div className="text-gray-800 font-semibold text-lg mb-2">Link Not Found</div>
        <div className="text-gray-500 text-sm">This link is invalid or has expired. Please contact your SirReel representative.</div>
        <div className="mt-4 text-sm text-gray-600">📞 <a href="tel:8185152389" className="font-semibold hover:underline">(818) 515-2389</a></div>
      </div>
    </div>
  );

  const ra = paperwork?.rentalAgreement;
  const lcdw = paperwork?.lcdwAccepted;
  const coi = paperwork?.coiReceived;
  const cc = paperwork?.creditCardAuth;
  const paperworkComplete = ra && coi && cc;
  const paperworkSteps = [
    { key: 'agreement' as PortalStep, label: 'Rental Agreement', done: ra, icon: '📋', required: true },
    { key: 'lcdw' as PortalStep, label: 'LCDW Waiver', done: lcdw, icon: '🛡️', required: true },
    { key: 'coi' as PortalStep, label: 'Certificate of Insurance', done: coi, icon: '📄', required: true },
    { key: 'cc' as PortalStep, label: 'Credit Card Auth', done: cc, icon: '💳', required: true },
  ];
  const completedCount = paperworkSteps.filter(s => s.done).length;

  const agent = booking.agent;
  const company = booking.company;
  const items = booking.items || [];

  const VEHICLE_ICONS: Record<string, string> = {
    'Cube': '🚛', 'Cargo': '🚐', 'Van': '🚐', 'Pass': '🚌',
    'PopVan': '🎬', 'Camera': '📷', 'DLUX': '✨', 'Scout': '📡',
    'Studios': '🏢', 'Studio': '🏢', 'Stake': '🚚', 'Trailer': '🚛',
  };
  const getIcon = (name: string) => {
    for (const [key, icon] of Object.entries(VEHICLE_ICONS)) {
      if (name.toLowerCase().includes(key.toLowerCase())) return icon;
    }
    return '🚗';
  };

  const rentalDays = booking.startDate && booking.endDate
    ? Math.ceil((new Date(booking.endDate).getTime() - new Date(booking.startDate).getTime()) / 86400000) + 1
    : 0;

  return (
    <div className="min-h-screen bg-[#F8F7F4]" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      {/* Google Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Modal */}
      {activeModal && (
        <PaperworkModal
          step={activeModal}
          token={token}
          onClose={() => setActiveModal(null)}
          onComplete={handlePaperworkComplete}
        />
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200/80 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold tracking-tight">SR</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 leading-tight">SirReel Studio Services</div>
              <div className="text-[10px] text-gray-400 leading-tight">Client Dashboard</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!paperworkComplete && (
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-[11px] text-amber-700 font-semibold">{completedCount}/4 paperwork done</span>
              </div>
            )}
            {paperworkComplete && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                <span className="text-emerald-600 text-xs">✓</span>
                <span className="text-[11px] text-emerald-700 font-semibold">All paperwork complete</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Hero — Job Overview */}
        <div className="bg-gray-900 rounded-2xl p-6 text-white relative overflow-hidden">
          {/* Background texture */}
          <div className="absolute inset-0 opacity-5" style={{
            backgroundImage: 'repeating-linear-gradient(45deg, white 0, white 1px, transparent 0, transparent 50%)',
            backgroundSize: '8px 8px'
          }} />
          <div className="relative">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Production</div>
                <h1 className="text-2xl font-bold text-white leading-tight">{booking.jobName}</h1>
                {booking.productionName && booking.productionName !== booking.jobName && (
                  <div className="text-gray-400 text-sm mt-0.5">{booking.productionName}</div>
                )}
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Booking</div>
                <div className="text-sm font-mono font-semibold text-gray-300">{booking.bookingNumber}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/10 rounded-xl p-3">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Company</div>
                <div className="text-sm font-semibold text-white">{company?.name}</div>
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Rental Start</div>
                <div className="text-sm font-semibold text-white">{fmtShort(booking.startDate)}</div>
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Rental End</div>
                <div className="text-sm font-semibold text-white">{fmtShort(booking.endDate)}</div>
              </div>
            </div>

            {booking.deliveryAddress && (
              <div className="mt-3 bg-white/10 rounded-xl px-3 py-2.5 flex items-center gap-2">
                <span className="text-gray-400 text-sm">📍</span>
                <div>
                  <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Delivery · </span>
                  <span className="text-sm text-gray-200">{booking.deliveryAddress}</span>
                  {booking.deliveryTime && <span className="text-gray-400 text-sm"> · {booking.deliveryTime}</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Two-col layout */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Vehicles & Equipment */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Your Rentals</div>
              <div className="text-[10px] text-gray-400">{rentalDays} day{rentalDays !== 1 ? 's' : ''}</div>
            </div>
            {items.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-4">No items yet</div>
            ) : (
              <div className="space-y-2">
                {items.map((item: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <div className="w-9 h-9 bg-white rounded-lg border border-gray-200 flex items-center justify-center text-lg flex-shrink-0">
                      {getIcon(item.category?.name || '')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate">{item.category?.name}</div>
                      <div className="text-[11px] text-gray-500">
                        {item.quantity > 1 ? `× ${item.quantity}` : ''} · ${Number(item.dailyRate).toFixed(0)}/day
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-gray-900">
                        ${(Number(item.dailyRate) * item.quantity * rentalDays).toLocaleString()}
                      </div>
                      <div className="text-[9px] text-gray-400">est. total</div>
                    </div>
                  </div>
                ))}
                {booking.totalPrice && (
                  <div className="flex justify-between items-center pt-2 mt-1 border-t border-gray-100">
                    <span className="text-xs text-gray-500 font-semibold">Estimated Total</span>
                    <span className="text-sm font-bold text-gray-900">${Number(booking.totalPrice).toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Calendar */}
          <MiniCalendar start={booking.startDate} end={booking.endDate} />
        </div>

        {/* Paperwork */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Paperwork</div>
            <div className="text-[11px] text-gray-400">{completedCount} of {paperworkSteps.length} complete</div>
          </div>
          {/* Progress bar */}
          <div className="w-full h-1.5 bg-gray-100 rounded-full mb-4 overflow-hidden">
            <div className="h-full bg-gray-900 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / paperworkSteps.length) * 100}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {paperworkSteps.map(step => (
              <button
                key={step.key}
                onClick={() => !step.done && setActiveModal(step.key)}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                  step.done
                    ? 'bg-emerald-50 border-emerald-200 cursor-default'
                    : 'bg-gray-50 border-gray-200 hover:border-gray-400 hover:bg-gray-100 cursor-pointer'
                }`}>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${
                  step.done ? 'bg-emerald-100' : 'bg-white border border-gray-200'
                }`}>
                  {step.done ? '✓' : step.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[11px] font-semibold truncate ${step.done ? 'text-emerald-700' : 'text-gray-700'}`}>
                    {step.label}
                  </div>
                  <div className={`text-[10px] ${step.done ? 'text-emerald-500' : 'text-gray-400'}`}>
                    {step.done ? 'Completed' : 'Tap to complete'}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {!paperworkComplete && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
              ⚠️ Please complete all paperwork before your rental start date of <strong>{fmtShort(booking.startDate)}</strong>.
            </div>
          )}
        </div>

        {/* Documents */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Documents</div>
          <div className="space-y-2">
            {[
              { label: 'Order Confirmation', icon: '📋', status: 'available', desc: 'Booking details & equipment list' },
              { label: 'Quote / Estimate', icon: '📊', status: booking.rentalworksOrderId ? 'available' : 'pending', desc: booking.rentalworksOrderId ? `Order #${booking.rentalworksOrderId}` : 'Pending from SirReel' },
              { label: 'Invoice', icon: '🧾', status: booking.invoiceStatus === 'sent' || booking.invoiceStatus === 'paid' ? 'available' : 'pending', desc: booking.invoiceStatus === 'paid' ? 'Paid ✓' : booking.invoiceStatus === 'sent' ? 'Awaiting payment' : 'Not yet issued' },
              { label: 'Signed Agreement', icon: '✍️', status: ra ? 'available' : 'pending', desc: ra ? 'Signed & on file' : 'Complete paperwork above' },
            ].map((doc, i) => (
              <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                doc.status === 'available' ? 'border-gray-200 hover:border-gray-300 cursor-pointer' : 'border-gray-100 opacity-60'
              }`}>
                <div className="w-9 h-9 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-center text-base flex-shrink-0">
                  {doc.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{doc.label}</div>
                  <div className="text-[11px] text-gray-400">{doc.desc}</div>
                </div>
                {doc.status === 'available' ? (
                  <div className="text-gray-400 text-sm flex-shrink-0">↓</div>
                ) : (
                  <div className="text-[10px] text-gray-300 flex-shrink-0 font-medium">Pending</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Contacts */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Your SirReel Team</div>
          <div className="space-y-3">
            {/* Rep */}
            {agent && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-9 h-9 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">{agent.name?.split(' ').map((n: string) => n[0]).join('').slice(0,2)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{agent.name}</div>
                  <div className="text-[11px] text-gray-500">Your Account Rep</div>
                </div>
                <div className="flex gap-2">
                  {agent.email && (
                    <a href={`mailto:${agent.email}`} className="w-8 h-8 bg-white border border-gray-200 rounded-lg flex items-center justify-center text-sm hover:bg-gray-100 transition-colors">✉️</a>
                  )}
                  {agent.phone && (
                    <a href={`tel:${agent.phone}`} className="w-8 h-8 bg-white border border-gray-200 rounded-lg flex items-center justify-center text-sm hover:bg-gray-100 transition-colors">📞</a>
                  )}
                </div>
              </div>
            )}

            {/* Office */}
            <div className="grid grid-cols-2 gap-2">
              <a href="tel:8185152389" className="flex items-center gap-2.5 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                <span className="text-base">📞</span>
                <div>
                  <div className="text-[11px] font-semibold text-gray-700">Office</div>
                  <div className="text-[10px] text-gray-500">(818) 515-2389</div>
                </div>
              </a>
              <a href="mailto:info@sirreel.com" className="flex items-center gap-2.5 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                <span className="text-base">✉️</span>
                <div>
                  <div className="text-[11px] font-semibold text-gray-700">Email</div>
                  <div className="text-[10px] text-gray-500">info@sirreel.com</div>
                </div>
              </a>
              <a href="https://www.sirreel.com" target="_blank" className="flex items-center gap-2.5 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                <span className="text-base">🌐</span>
                <div>
                  <div className="text-[11px] font-semibold text-gray-700">Website</div>
                  <div className="text-[10px] text-gray-500">www.sirreel.com</div>
                </div>
              </a>
              <div className="flex items-center gap-2.5 p-3 bg-gray-50 rounded-xl">
                <span className="text-base">⏰</span>
                <div>
                  <div className="text-[11px] font-semibold text-gray-700">Hours</div>
                  <div className="text-[10px] text-gray-500">M–F 6a–6p · Sat 7a–3:30p</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* DOT & Compliance */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Driver & Compliance Requirements</div>
          <div className="space-y-2 text-sm text-gray-600 leading-relaxed">
            <div className="flex items-start gap-2.5 p-3 bg-gray-50 rounded-xl">
              <span className="text-base mt-0.5">🪪</span>
              <div><span className="font-semibold text-gray-800">Driver Licensing: </span>All drivers must be duly licensed, trained, and qualified to drive vehicles of this type. A valid driver's license is required for all vehicle operators.</div>
            </div>
            <div className="flex items-start gap-2.5 p-3 bg-gray-50 rounded-xl">
              <span className="text-base mt-0.5">🚫</span>
              <div><span className="font-semibold text-gray-800">Non-Smoking: </span>All vehicles are non-smoking. A $250/day fee applies for violations, plus cost of repairs.</div>
            </div>
            <div className="flex items-start gap-2.5 p-3 bg-gray-50 rounded-xl">
              <span className="text-base mt-0.5">⛽</span>
              <div><span className="font-semibold text-gray-800">Fuel Policy: </span>Vehicles must be returned at the same fuel level they were dispatched. A $10/gallon fee applies for shortfalls.</div>
            </div>
            <div className="flex items-start gap-2.5 p-3 bg-gray-50 rounded-xl">
              <span className="text-base mt-0.5">🔖</span>
              <div><span className="font-semibold text-gray-800">Vehicle Identification: </span>Do not remove, obscure, or deface any SirReel identification markings on vehicles or equipment.</div>
            </div>
            {paperwork?.dotNumber && (
              <div className="flex items-start gap-2.5 p-3 bg-blue-50 rounded-xl border border-blue-100">
                <span className="text-base mt-0.5">📋</span>
                <div><span className="font-semibold text-blue-800">DOT / CA Number on file: </span><span className="font-mono text-blue-700">{paperwork.dotNumber}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-[11px] text-gray-400">SirReel Studio Services</p>
          <p className="text-[11px] text-gray-400">Los Angeles, California · (818) 515-2389</p>
        </div>

      </main>
    </div>
  );
}
