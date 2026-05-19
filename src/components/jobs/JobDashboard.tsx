'use client';

import { useEffect, useState } from 'react';
import PaperworkTab from '@/components/jobs/PaperworkTab';

/**
 * Job detail drawer. Pulls native Booking detail from
 * /api/bookings/[id] — replaces the earlier RentalWorks-coupled
 * version. Renders 7 role-gated tabs: Overview / Client / Paperwork /
 * Vehicles / Financials / Dispatch / Warehouse (+ Damage / Notes for
 * Admin).
 *
 * Each tab degrades gracefully — when a Booking has no associated
 * data for a tab (e.g. dispatch tasks, line items, insurance claims),
 * the tab shows an explicit empty state instead of blank space. This
 * is the common shape for Create & Send-originated bookings, which
 * carry company + person + paperwork-portal but no line items or
 * dispatch records yet.
 */

const ROLE_SECTIONS: Record<string, string[]> = {
  ADMIN:       ['overview', 'client', 'paperwork', 'vehicles', 'financials', 'dispatch', 'warehouse', 'damage', 'notes'],
  SALES:       ['overview', 'client', 'paperwork', 'financials', 'vehicles', 'notes'],
  FLEET:       ['overview', 'vehicles', 'paperwork', 'dispatch', 'damage'],
  WAREHOUSE:   ['overview', 'vehicles', 'warehouse', 'dispatch'],
  COLLECTIONS: ['overview', 'financials', 'paperwork', 'client'],
};

const SECTION_META: Record<string, { label: string; icon: string }> = {
  overview:   { label: 'Overview',    icon: '📋' },
  client:     { label: 'Client',      icon: '👤' },
  paperwork:  { label: 'Paperwork',   icon: '📝' },
  vehicles:   { label: 'Vehicles',    icon: '🚛' },
  financials: { label: 'Financials',  icon: '💰' },
  dispatch:   { label: 'Dispatch',    icon: '📍' },
  warehouse:  { label: 'Warehouse',   icon: '📦' },
  damage:     { label: 'Damage/Ins',  icon: '🔧' },
  notes:      { label: 'Notes',       icon: '💬' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  REQUEST:          { label: 'Requested',  color: 'text-amber-700',   bg: 'bg-amber-50',   dot: 'bg-amber-500' },
  AI_REVIEW:        { label: 'AI Review',  color: 'text-violet-700',  bg: 'bg-violet-50',  dot: 'bg-violet-500' },
  PENDING_APPROVAL: { label: 'Pending',    color: 'text-orange-700',  bg: 'bg-orange-50',  dot: 'bg-orange-500' },
  CONFIRMED:        { label: 'Confirmed',  color: 'text-blue-700',    bg: 'bg-blue-50',    dot: 'bg-blue-500' },
  ACTIVE:           { label: 'Active',     color: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500' },
  RETURNED:         { label: 'Returned',   color: 'text-zinc-700',    bg: 'bg-zinc-100',   dot: 'bg-zinc-400' },
  CANCELLED:        { label: 'Cancelled',  color: 'text-red-600',     bg: 'bg-red-50',     dot: 'bg-red-500' },
  ARCHIVED:         { label: 'Archived',   color: 'text-zinc-500',    bg: 'bg-zinc-50',    dot: 'bg-zinc-300' },
};

function fDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fShort(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fMoney(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n as number)) return '—';
  return (n as number).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

type Props = {
  /** Booking row id. Kept as `orderId` for back-compat with callers
   *  that haven't been renamed; semantically a Booking.id. */
  orderId: string | null;
  /** Booking row number (e.g. SR-2026-8969). Same renaming caveat. */
  orderNumber: string;
  onClose: () => void;
  userRole?: string;
  userName?: string;
};

export default function JobDashboard({ orderId: bookingId, orderNumber: bookingNumber, onClose, userRole, userName: _userName }: Props) {
  const [booking, setBooking] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('overview');

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
    } catch {
      return 'ADMIN';
    }
  })();

  const sections = ROLE_SECTIONS[role] || ROLE_SECTIONS.ADMIN;

  useEffect(() => {
    if (!bookingId) return;
    setLoading(true);
    setBooking(null);
    setError(null);
    setActiveSection('overview');
    fetch(`/api/bookings/${bookingId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.booking) setBooking(d.booking);
        else setError(d?.error || 'Booking not found');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [bookingId]);

  if (!bookingId) return null;

  const status: string = booking?.status || '';
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.ARCHIVED;
  const projectName = booking?.productionName || booking?.jobName || `Booking ${bookingNumber}`;
  const paperwork = booking?.paperworkRequests?.[0] || null;
  const orders = booking?.orders || [];
  const allSignedAgreements = orders.flatMap((o: any) => o.signedAgreements || []);
  const rentalAgreement = allSignedAgreements.find((a: any) => a.contractType === 'RENTAL_AGREEMENT') || null;
  const stageContract = allSignedAgreements.find((a: any) => a.contractType === 'STAGE_CONTRACT') || null;
  const portalAccesses = orders.flatMap((o: any) => o.portalAccesses || []);
  const hasRwLink = !!booking?.rentalworksOrderId;

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
                <div className="text-[15px] font-extrabold text-gray-900 truncate">{projectName}</div>
                <div className="text-[11px] text-gray-400 font-mono">
                  Booking #{bookingNumber}
                  {booking?.company?.name && ` · ${booking.company.name}`}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="ml-3 flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 text-sm transition-colors">✕</button>
          </div>

          <div className="px-5 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              {booking?.startDate && (
                <span className="flex items-center gap-1">
                  <span className="text-gray-300">📅</span>
                  {fShort(booking.startDate)}{booking.endDate ? ` – ${fShort(booking.endDate)}` : ''}
                </span>
              )}
              {booking?.agent?.name && (
                <span className="flex items-center gap-1">
                  <span className="text-gray-300">👤</span>
                  {booking.agent.name}
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

          <div className="flex overflow-x-auto border-t border-gray-100 px-5 gap-0 scrollbar-hide">
            {sections.map((sec) => {
              const meta = SECTION_META[sec];
              return (
                <button
                  key={sec}
                  onClick={() => setActiveSection(sec)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-colors ${
                    activeSection === sec ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
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
              <span className="text-[12px]">Loading booking…</span>
            </div>
          ) : error ? (
            <div className="p-5">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-[12px] text-red-700">{error}</div>
            </div>
          ) : booking ? (
            <div className="p-5 space-y-4">
              {activeSection === 'overview' && <OverviewTab booking={booking} paperwork={paperwork} rentalAgreement={rentalAgreement} stageContract={stageContract} />}
              {activeSection === 'client' && <ClientTab booking={booking} portalAccesses={portalAccesses} paperwork={paperwork} />}
              {activeSection === 'paperwork' && (
                <PaperworkTab
                  booking={booking}
                  token={paperwork?.token}
                />
              )}
              {activeSection === 'vehicles' && <VehiclesTab booking={booking} />}
              {activeSection === 'financials' && <FinancialsTab booking={booking} />}
              {activeSection === 'dispatch' && <DispatchTab booking={booking} />}
              {activeSection === 'warehouse' && <WarehouseTab booking={booking} />}
              {activeSection === 'damage' && <DamageTab booking={booking} />}
              {activeSection === 'notes' && <NotesTab booking={booking} role={role} />}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 p-4 border-t border-gray-100 flex gap-2">
          {hasRwLink ? (
            <a
              href={`https://sirreel.rentalworks.cloud/order/${booking.rentalworksOrderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2.5 rounded-xl bg-gray-900 text-white text-[12px] font-bold text-center hover:bg-gray-700 transition-colors"
            >
              Open in RentalWorks ↗
            </a>
          ) : (
            <div className="flex-1 py-2.5 text-center text-[11px] text-gray-400">Native booking — no RentalWorks counterpart</div>
          )}
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[12px] font-semibold hover:bg-gray-200 transition-colors">
            Close
          </button>
        </div>
      </div>
    </>
  );
}

// ── Tab components ────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="text-center py-10 text-gray-400">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-[12px]">{text}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-3">{title}</div>
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[9px] text-gray-400 uppercase font-bold">{label}</div>
      <div className="text-[12px] text-gray-800 font-semibold">{value}</div>
    </div>
  );
}

function OverviewTab({ booking, paperwork, rentalAgreement, stageContract }: { booking: any; paperwork: any; rentalAgreement: any; stageContract: any }) {
  const durationDays =
    booking?.startDate && booking?.endDate
      ? Math.max(1, Math.round((new Date(booking.endDate).getTime() - new Date(booking.startDate).getTime()) / 86_400_000) + 1)
      : null;

  const itemCount = (booking?.items?.length || 0) + (booking?.orders?.reduce((s: number, o: any) => s + (o.lineItems?.length || 0), 0) || 0);

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Total Value</div>
          <div className="text-lg font-extrabold text-gray-900">{booking?.totalPrice ? fMoney(booking.totalPrice) : '—'}</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Duration</div>
          <div className="text-lg font-extrabold text-gray-900">{durationDays ? `${durationDays}d` : '—'}</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Items</div>
          <div className="text-lg font-extrabold text-gray-900">{itemCount}</div>
        </div>
      </div>

      <Card title="Booking Details">
        <div className="grid grid-cols-2 gap-3">
          <KV label="Job Name" value={booking?.jobName} />
          <KV label="Production" value={booking?.productionName} />
          <KV label="Start" value={fDate(booking?.startDate)} />
          <KV label="End" value={fDate(booking?.endDate)} />
          <KV label="Agent" value={booking?.agent?.name} />
          <KV label="Priority" value={booking?.priority} />
          <KV label="Source" value={booking?.source} />
          <KV label="Created" value={fDate(booking?.createdAt)} />
          <KV label="Confirmed" value={booking?.confirmedAt ? fDate(booking.confirmedAt) : null} />
          <KV label="Returned" value={booking?.returnedAt ? fDate(booking.returnedAt) : null} />
        </div>
      </Card>

      {(paperwork || rentalAgreement || stageContract) && (
        <Card title="Paperwork Snapshot">
          <div className="flex gap-2 flex-wrap">
            {[
              { label: 'Rental Agreement', done: !!rentalAgreement?.signedAt || booking?.rentalAgreement },
              { label: 'Stage Contract', done: !!stageContract?.signedAt, show: !!stageContract || paperwork?.contractType === 'stage' || paperwork?.contractType === 'both' },
              { label: 'COI', done: booking?.coiReceived || paperwork?.coiReceived },
              { label: 'CC Auth', done: paperwork?.creditCardAuth },
            ]
              .filter((c) => c.show !== false)
              .map((item) => (
                <div
                  key={item.label}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                    item.done ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'
                  }`}
                >
                  <span>{item.done ? '✓' : '○'}</span>
                  {item.label}
                </div>
              ))}
          </div>
        </Card>
      )}
    </>
  );
}

function ClientTab({ booking, portalAccesses, paperwork }: { booking: any; portalAccesses: any[]; paperwork: any }) {
  return (
    <>
      <Card title="Company">
        {booking?.company ? (
          <>
            <div className="text-[13px] font-bold text-gray-900">{booking.company.name}</div>
            {booking.company.billingAddress && <div className="text-[11px] text-gray-600 mt-0.5 whitespace-pre-line">{booking.company.billingAddress}</div>}
            {booking.company.billingEmail && (
              <a href={`mailto:${booking.company.billingEmail}`} className="text-[11px] text-blue-600 hover:underline block mt-0.5">{booking.company.billingEmail}</a>
            )}
            {booking.company.billingPhone && <div className="text-[11px] text-gray-500 mt-0.5">{booking.company.billingPhone}</div>}
          </>
        ) : (
          <div className="text-[12px] text-gray-400">No company on file.</div>
        )}
      </Card>

      <Card title="Primary Contact">
        {booking?.person ? (
          <>
            <div className="text-[12px] font-semibold text-gray-900">{booking.person.firstName} {booking.person.lastName}</div>
            {booking.person.email && (
              <a href={`mailto:${booking.person.email}`} className="text-[11px] text-blue-600 hover:underline block">{booking.person.email}</a>
            )}
            {booking.person.phone && (
              <a href={`tel:${booking.person.phone}`} className="text-[11px] text-gray-500 hover:underline block">{booking.person.phone}</a>
            )}
            {booking.person.title && <div className="text-[10px] text-gray-400 mt-0.5">{booking.person.title}</div>}
          </>
        ) : (
          <div className="text-[12px] text-gray-400">No primary contact on file.</div>
        )}
      </Card>

      {booking?.referredBy && (
        <Card title="Referred By">
          <div className="text-[12px] font-semibold text-gray-900">{booking.referredBy.firstName} {booking.referredBy.lastName}</div>
          {booking.referredBy.email && (
            <a href={`mailto:${booking.referredBy.email}`} className="text-[11px] text-blue-600 hover:underline block">{booking.referredBy.email}</a>
          )}
        </Card>
      )}

      {paperwork?.signerName && (
        <Card title="Agreement Signer">
          <div className="text-[12px] font-semibold text-gray-900">{paperwork.signerName}</div>
          {paperwork.signerTitle && <div className="text-[11px] text-gray-500">{paperwork.signerTitle}</div>}
          {paperwork.signerEmail && <div className="text-[11px] text-gray-500">{paperwork.signerEmail}</div>}
        </Card>
      )}

      {portalAccesses.length > 0 && (
        <Card title="Portal Access">
          <div className="space-y-2">
            {portalAccesses.map((pa) => (
              <div key={pa.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-gray-900 truncate">{pa.contact?.firstName} {pa.contact?.lastName}</div>
                  <div className="text-[10px] text-gray-500 truncate">{pa.contact?.email}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${pa.revokedAt ? 'bg-red-100 text-red-700' : pa.lastAccessedAt ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {pa.revokedAt ? 'REVOKED' : pa.lastAccessedAt ? 'OPENED' : 'NOT YET'}
                  </div>
                  {pa.lastAccessedAt && <div className="text-[9px] text-gray-400 mt-0.5">{fShort(pa.lastAccessedAt)}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {paperwork?.token && (
        <Card title="Quick Links">
          <div className="flex gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/client/${paperwork.token}`)}
              className="flex-1 py-2 bg-blue-600 text-white text-[11px] font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              Copy Dashboard Link
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/${paperwork.token}`)}
              className="flex-1 py-2 bg-white border border-blue-200 text-blue-700 text-[11px] font-semibold rounded-lg hover:bg-blue-50 transition-colors"
            >
              Copy Paperwork Link
            </button>
          </div>
        </Card>
      )}
    </>
  );
}

function VehiclesTab({ booking }: { booking: any }) {
  const orderLineItems = (booking?.orders || []).flatMap((o: any) => o.lineItems || []);
  const bookingItems = booking?.items || [];
  const hasAny = orderLineItems.length > 0 || bookingItems.length > 0;

  if (!hasAny) {
    return <EmptyState icon="🚛" text="No vehicles or equipment assigned yet — add line items via the Order editor." />;
  }

  return (
    <>
      {bookingItems.length > 0 && (
        <Card title="Booking Items">
          <div className="space-y-2">
            {bookingItems.map((item: any) => (
              <div key={item.id} className="p-3 bg-gray-50 rounded-xl">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="text-[12px] font-semibold text-gray-900">{item.category?.name || 'Item'}</div>
                  <div className="text-[11px] font-bold text-gray-700">×{item.quantity}</div>
                </div>
                <div className="text-[10px] text-gray-500">{fMoney(item.dailyRate)} / day · status {item.status}</div>
                {item.assignments?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {item.assignments.map((a: any) => (
                      <div key={a.id} className="flex items-center gap-2 text-[10px]">
                        <span className="font-mono text-gray-700">{a.asset?.unitName || '?'}</span>
                        <span className="text-gray-400">·</span>
                        <span className="text-gray-500">{a.asset?.licensePlate || a.asset?.vin || 'no plate/VIN'}</span>
                        <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold ${a.status === 'CHECKED_OUT' ? 'bg-emerald-100 text-emerald-700' : a.status === 'RETURNED' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'}`}>{a.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {orderLineItems.length > 0 && (
        <Card title="Order Line Items">
          <div className="space-y-2">
            {orderLineItems.map((li: any) => (
              <div key={li.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-gray-900 truncate">{li.description || li.assetCategory?.name || li.type}</div>
                  <div className="text-[10px] text-gray-500">{li.assetCategory?.name || li.type}{li.billableDays ? ` · ${li.billableDays}d` : ''}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[12px] font-bold text-gray-900">×{li.quantity}</div>
                  {li.lineTotal && <div className="text-[10px] text-gray-500">{fMoney(li.lineTotal)}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function FinancialsTab({ booking }: { booking: any }) {
  const orderLineItems = (booking?.orders || []).flatMap((o: any) => o.lineItems || []);
  const lineItemTotal = orderLineItems.reduce((s: number, li: any) => s + Number(li.lineTotal || 0), 0);
  const hasFinancials = booking?.totalPrice || booking?.depositAmount || booking?.invoiceStatus || lineItemTotal > 0;

  if (!hasFinancials) {
    return <EmptyState icon="💰" text="No financials yet — totals appear once line items and quotes are added." />;
  }

  return (
    <>
      <Card title="Financial Summary">
        <div className="space-y-2">
          {booking?.totalPrice && (
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-[12px] text-gray-600">Booking Total</span>
              <span className="text-[14px] font-extrabold text-gray-900">{fMoney(booking.totalPrice)}</span>
            </div>
          )}
          {lineItemTotal > 0 && (
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-[12px] text-gray-600">Line Items Subtotal</span>
              <span className="text-[13px] font-bold text-gray-900">{fMoney(lineItemTotal)}</span>
            </div>
          )}
          {booking?.depositAmount && (
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-[12px] text-gray-600">Deposit Required</span>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-gray-900">{fMoney(booking.depositAmount)}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${booking.depositPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {booking.depositPaid ? 'PAID' : 'UNPAID'}
                </span>
              </div>
            </div>
          )}
          {booking?.invoiceStatus && (
            <div className="flex justify-between items-center py-2">
              <span className="text-[12px] text-gray-600">Invoice Status</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${
                booking.invoiceStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                booking.invoiceStatus === 'sent' ? 'bg-blue-100 text-blue-700' :
                booking.invoiceStatus === 'overdue' ? 'bg-red-100 text-red-600' :
                'bg-gray-100 text-gray-500'
              }`}>{(booking.invoiceStatus || 'NOT CREATED').toUpperCase()}</span>
            </div>
          )}
        </div>
      </Card>

      {orderLineItems.length > 0 && (
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
              {orderLineItems.map((li: any) => (
                <tr key={li.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-800">{li.description || li.assetCategory?.name || li.type}</div>
                    {li.assetCategory?.name && <div className="text-[9px] text-gray-400">{li.assetCategory.name}</div>}
                  </td>
                  <td className="px-2 py-2.5 text-center text-gray-600">{li.quantity}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{li.lineTotal ? fMoney(li.lineTotal) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={2} className="px-4 py-2.5 text-[10px] font-bold text-gray-500 uppercase">Total</td>
                <td className="px-4 py-2.5 text-right font-extrabold text-gray-900">{fMoney(lineItemTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function DispatchTab({ booking }: { booking: any }) {
  const hasDispatchInfo = booking?.deliveryAddress || booking?.pickupAddress || (booking?.dispatchTasks?.length || 0) > 0;
  if (!hasDispatchInfo) {
    return <EmptyState icon="📍" text="No dispatch records yet. Delivery / pickup details appear once scheduled." />;
  }
  return (
    <>
      {(booking.deliveryAddress || booking.pickupAddress) && (
        <Card title="Logistics">
          <div className="space-y-3">
            {booking.deliveryAddress && (
              <div className="p-3 bg-gray-50 rounded-xl">
                <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">📍 Delivery</div>
                <div className="text-[12px] font-semibold text-gray-900 whitespace-pre-line">{booking.deliveryAddress}</div>
                {booking.deliveryTime && <div className="text-[11px] text-gray-500 mt-0.5">{booking.deliveryTime}</div>}
              </div>
            )}
            {booking.pickupAddress && (
              <div className="p-3 bg-gray-50 rounded-xl">
                <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">🔁 Pickup</div>
                <div className="text-[12px] font-semibold text-gray-900 whitespace-pre-line">{booking.pickupAddress}</div>
                {booking.pickupTime && <div className="text-[11px] text-gray-500 mt-0.5">{booking.pickupTime}</div>}
              </div>
            )}
          </div>
        </Card>
      )}

      {booking.dispatchTasks?.length > 0 && (
        <Card title="Dispatch Tasks">
          <div className="space-y-1.5">
            {booking.dispatchTasks.map((task: any) => (
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
        </Card>
      )}
    </>
  );
}

function WarehouseTab({ booking }: { booking: any }) {
  const items = booking?.items || [];
  const totalAssignments = items.reduce((s: number, i: any) => s + (i.assignments?.length || 0), 0);
  if (items.length === 0) {
    return <EmptyState icon="📦" text="No pick list yet — items appear here once line items are added to the booking." />;
  }
  return (
    <Card title="Pick List">
      <div className="space-y-1.5">
        {items.map((item: any) => (
          <div key={item.id} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-xl">
            <div className="w-6 h-6 border-2 border-gray-300 rounded flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-gray-900 truncate">{item.category?.name || 'Item'}</div>
              <div className="text-[9px] text-gray-400">{item.assignments?.length || 0} of {item.quantity} assigned</div>
            </div>
            <div className="text-[13px] font-extrabold text-gray-700 flex-shrink-0">×{item.quantity}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-[11px]">
        <span className="text-gray-500">Total assignments</span>
        <span className="font-bold text-gray-900">{totalAssignments}</span>
      </div>
    </Card>
  );
}

function DamageTab({ booking }: { booking: any }) {
  const claims = booking?.insuranceClaims || [];
  if (claims.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="text-3xl mb-2">✅</div>
        <div className="text-[12px] text-gray-500">No damage claims on this booking.</div>
      </div>
    );
  }
  return (
    <Card title="Insurance Claims">
      <div className="space-y-2">
        {claims.map((claim: any) => (
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
              <div className="text-[11px] text-red-700 font-semibold mt-1">Est. Repair: {fMoney(claim.estimatedRepairCost)}</div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function NotesTab({ booking, role }: { booking: any; role: string }) {
  return (
    <div className="space-y-3">
      {booking.notes && (
        <Card title="Job Notes">
          <p className="text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap">{booking.notes}</p>
        </Card>
      )}
      {booking.adminNotes && role === 'ADMIN' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="text-[10px] font-bold text-amber-600 uppercase mb-2">Admin Notes</div>
          <p className="text-[12px] text-amber-800 leading-relaxed whitespace-pre-wrap">{booking.adminNotes}</p>
        </div>
      )}
      {!booking.notes && !booking.adminNotes && (
        <EmptyState icon="💬" text="No notes on this booking yet." />
      )}
    </div>
  );
}
