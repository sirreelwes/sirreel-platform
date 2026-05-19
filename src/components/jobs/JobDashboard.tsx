'use client';

import { useEffect, useState } from 'react';
import PaperworkTab from '@/components/jobs/PaperworkTab';

/**
 * Job detail drawer — single-scroll TSX-branded layout. Reads native
 * Booking detail from /api/bookings/[id]. Replaces an earlier tabbed
 * view; sections are now always-visible with empty states so layout
 * is consistent.
 *
 * Visual language tracks the TSX portal-invite / booking-welcome
 * emails: DARK = #0a0a0a, GOLD = #D4A547, Georgia serif headings,
 * subtle borders, light card backgrounds. Sticky dark header on top,
 * sticky action footer on bottom, content scrolls between.
 */

const STATUS_CONFIG: Record<string, { label: string; bgChip: string; textChip: string; dot: string }> = {
  REQUEST:          { label: 'Requested',  bgChip: 'bg-amber-500/20',   textChip: 'text-amber-200',   dot: 'bg-amber-400'   },
  AI_REVIEW:        { label: 'AI Review',  bgChip: 'bg-violet-500/20',  textChip: 'text-violet-200',  dot: 'bg-violet-400'  },
  PENDING_APPROVAL: { label: 'Pending',    bgChip: 'bg-orange-500/20',  textChip: 'text-orange-200',  dot: 'bg-orange-400'  },
  CONFIRMED:        { label: 'Confirmed',  bgChip: 'bg-blue-500/20',    textChip: 'text-blue-200',    dot: 'bg-blue-400'    },
  ACTIVE:           { label: 'Active',     bgChip: 'bg-emerald-500/20', textChip: 'text-emerald-200', dot: 'bg-emerald-400' },
  RETURNED:         { label: 'Returned',   bgChip: 'bg-zinc-500/20',    textChip: 'text-zinc-200',    dot: 'bg-zinc-400'    },
  CANCELLED:        { label: 'Cancelled',  bgChip: 'bg-red-500/20',     textChip: 'text-red-200',     dot: 'bg-red-400'     },
  ARCHIVED:         { label: 'Archived',   bgChip: 'bg-zinc-500/15',    textChip: 'text-zinc-300',    dot: 'bg-zinc-400'    },
};

const GOLD = '#D4A547';
const DARK = '#0a0a0a';

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
  /** Booking id — kept as `orderId` for callsite back-compat. */
  orderId: string | null;
  /** Booking number — kept as `orderNumber` for callsite back-compat. */
  orderNumber: string;
  onClose: () => void;
  userRole?: string;
  userName?: string;
};

export default function JobDashboard({ orderId: bookingId, orderNumber: bookingNumber, onClose, userRole, userName: _userName }: Props) {
  const [booking, setBooking] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

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

  useEffect(() => {
    if (!bookingId) return;
    setLoading(true);
    setBooking(null);
    setError(null);
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
  const isArchived = !!booking?.archivedAt;

  const archiveBooking = async () => {
    if (!booking?.id) return;
    if (!confirm(`Archive "${projectName}"? You can restore it later from Show archived.`)) return;
    setArchiveBusy(true);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/archive`, { method: 'POST' });
      if (res.ok) onClose();
      else alert('Archive failed');
    } finally {
      setArchiveBusy(false);
    }
  };
  const restoreBooking = async () => {
    if (!booking?.id) return;
    setArchiveBusy(true);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/restore`, { method: 'POST' });
      if (res.ok) onClose();
      else alert('Restore failed');
    } finally {
      setArchiveBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 w-[680px] max-w-[96vw] bg-white shadow-2xl flex flex-col">
        {/* ── TSX-branded sticky header ──────────────────────────────── */}
        <div className="flex-shrink-0" style={{ backgroundColor: DARK }}>
          <div className="px-6 pt-5 pb-5 relative">
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center text-sm transition-colors"
            >
              ✕
            </button>

            {/* Booking number + company line */}
            <div className="text-[10px] uppercase tracking-[2px] font-semibold" style={{ color: GOLD }}>
              Booking #{bookingNumber}
              {booking?.company?.name && <span className="text-white/40 font-normal normal-case tracking-normal"> · {booking.company.name}</span>}
            </div>

            {/* Serif job name */}
            <h2
              className="mt-1 text-white text-[28px] leading-tight font-light italic"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              {projectName}
            </h2>

            {/* Status / dates / agent / role row */}
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              {status && (
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ${cfg.bgChip}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  <span className={`text-[10px] font-bold tracking-wider uppercase ${cfg.textChip}`}>{cfg.label}</span>
                </span>
              )}
              {isArchived && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/10">
                  <span className="text-[10px] font-bold tracking-wider uppercase text-white/60">Archived</span>
                </span>
              )}
              {booking?.startDate && (
                <span className="text-[11px] text-white/70 flex items-center gap-1">
                  <span className="text-white/30">📅</span>
                  {fShort(booking.startDate)}{booking.endDate ? ` – ${fShort(booking.endDate)}` : ''}
                </span>
              )}
              {booking?.agent?.name && (
                <span className="text-[11px] text-white/70 flex items-center gap-1">
                  <span className="text-white/30">👤</span>
                  {booking.agent.name}
                </span>
              )}
              <span className={`ml-auto text-[9px] font-bold px-2 py-0.5 rounded-md ${
                role === 'ADMIN' ? 'bg-purple-500/30 text-purple-100' :
                role === 'SALES' ? 'bg-blue-500/30 text-blue-100' :
                role === 'FLEET' ? 'bg-emerald-500/30 text-emerald-100' :
                role === 'WAREHOUSE' ? 'bg-orange-500/30 text-orange-100' :
                'bg-white/10 text-white/70'
              }`}>{role}</span>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin mb-3" />
              <span className="text-[12px]">Loading booking…</span>
            </div>
          ) : error ? (
            <div className="p-6">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-[12px] text-red-700">{error}</div>
            </div>
          ) : booking ? (
            <div className="px-6 py-6 space-y-7">
              <QuickStats booking={booking} />
              <Section title="Paperwork" subtitle="The signing surface that drives this booking">
                <PaperworkStatusPills booking={booking} paperwork={paperwork} rentalAgreement={rentalAgreement} stageContract={stageContract} />
                <div className="mt-4">
                  <PaperworkTab booking={booking} token={paperwork?.token} />
                </div>
              </Section>

              <Section title="Booking Details" subtitle="What sales captured at intake">
                <DetailsGrid booking={booking} />
              </Section>

              <Section title="Client" subtitle="Company, contacts, portal access">
                <ClientBlock booking={booking} portalAccesses={portalAccesses} paperwork={paperwork} />
              </Section>

              <Section title="Vehicles & Equipment" subtitle="Line items assigned to this booking">
                <VehiclesBlock booking={booking} />
              </Section>

              <Section title="Financials" subtitle="Totals, deposits, invoices">
                <FinancialsBlock booking={booking} />
              </Section>

              <Section title="Dispatch" subtitle="Pickup / return logistics">
                <DispatchBlock booking={booking} />
              </Section>

              <Section title="Warehouse" subtitle="Pick list and check-out status">
                <WarehouseBlock booking={booking} />
              </Section>

              <Section title="Notes" subtitle="Internal context for the team">
                <NotesBlock booking={booking} role={role} />
              </Section>
            </div>
          ) : null}
        </div>

        {/* ── Sticky action footer ───────────────────────────────────── */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-200 bg-white flex gap-2">
          {booking && (
            isArchived ? (
              <button
                onClick={restoreBooking}
                disabled={archiveBusy}
                className="flex-1 py-2.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-[12px] font-semibold hover:bg-blue-100 disabled:opacity-50 transition-colors"
              >
                {archiveBusy ? '…' : 'Restore Booking'}
              </button>
            ) : (
              <button
                onClick={archiveBooking}
                disabled={archiveBusy}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 text-[12px] font-semibold hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50 transition-colors"
              >
                {archiveBusy ? '…' : 'Archive'}
              </button>
            )
          )}
          {hasRwLink && (
            <a
              href={`https://sirreel.rentalworks.cloud/order/${booking.rentalworksOrderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2.5 rounded-xl text-[12px] font-bold text-center transition-colors hover:opacity-90"
              style={{ backgroundColor: GOLD, color: DARK }}
            >
              Open in RentalWorks ↗
            </a>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-[12px] font-semibold transition-colors text-white"
            style={{ backgroundColor: DARK }}
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}

// ── Section + shared primitives ───────────────────────────────────────────────

/**
 * TSX-branded section wrapper. Heading uses the gold/uppercase kicker
 * + Georgia-italic title pattern from the booking-welcome email. Body
 * sits in a clean light card below.
 */
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[2px] font-bold text-gray-400">
            {title}
          </div>
          {subtitle && (
            <div
              className="text-gray-500 text-[13px] mt-0.5 italic"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              {subtitle}
            </div>
          )}
        </div>
        <span className="flex-1 ml-3 mt-2 border-t border-gray-100" />
      </div>
      <div>{children}</div>
    </section>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="text-center py-6 text-gray-400 bg-gray-50/50 border border-dashed border-gray-200 rounded-xl">
      <div className="text-2xl mb-1.5 opacity-60">{icon}</div>
      <div className="text-[11px]">{text}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider">{label}</div>
      <div className="text-[12px] text-gray-800 font-semibold mt-0.5">{value || '—'}</div>
    </div>
  );
}

// ── Section bodies ────────────────────────────────────────────────────────────

function QuickStats({ booking }: { booking: any }) {
  const durationDays =
    booking?.startDate && booking?.endDate
      ? Math.max(1, Math.round((new Date(booking.endDate).getTime() - new Date(booking.startDate).getTime()) / 86_400_000) + 1)
      : null;
  const itemCount = (booking?.items?.length || 0) + (booking?.orders?.reduce((s: number, o: any) => s + (o.lineItems?.length || 0), 0) || 0);

  const stats: { label: string; value: string }[] = [
    { label: 'Total Value', value: booking?.totalPrice ? fMoney(booking.totalPrice) : '—' },
    { label: 'Duration', value: durationDays ? `${durationDays}d` : '—' },
    { label: 'Items', value: String(itemCount) },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-3.5">
          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">{s.label}</div>
          <div className="text-[22px] font-extrabold text-gray-900 leading-none">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function PaperworkStatusPills({ booking, paperwork, rentalAgreement, stageContract }: { booking: any; paperwork: any; rentalAgreement: any; stageContract: any }) {
  const contractType: string = paperwork?.contractType || (booking?.contractType ?? 'vehicles');
  const wantsStage = contractType === 'stage' || contractType === 'both';
  const wantsVehicles = contractType === 'vehicles' || contractType === 'both' || !contractType;

  const pills: { label: string; icon: string; state: 'signed' | 'pending' | 'not-sent' | 'na'; detail: string }[] = [];

  if (wantsVehicles) {
    const signed = rentalAgreement?.signedAt || booking?.rentalAgreement || paperwork?.rentalAgreement;
    pills.push({
      label: 'Rental Agreement',
      icon: '📄',
      state: signed ? 'signed' : paperwork ? 'pending' : 'not-sent',
      detail: signed && rentalAgreement?.signedAt ? `Signed ${fShort(rentalAgreement.signedAt)}` : signed ? 'Signed' : paperwork ? 'Awaiting signature' : 'Not sent yet',
    });
  }
  if (wantsStage) {
    const signed = stageContract?.signedAt || paperwork?.studioContractSigned;
    pills.push({
      label: 'Stage Contract',
      icon: '🎬',
      state: signed ? 'signed' : paperwork ? 'pending' : 'not-sent',
      detail: signed && stageContract?.signedAt ? `Signed ${fShort(stageContract.signedAt)}` : signed ? 'Signed' : paperwork ? 'Awaiting signature' : 'Not generated',
    });
  }
  pills.push({
    label: 'COI',
    icon: '🛡',
    state: booking?.coiReceived || paperwork?.coiReceived ? 'signed' : paperwork ? 'pending' : 'not-sent',
    detail: booking?.coiReceived || paperwork?.coiReceived ? 'On file' : paperwork ? 'Awaiting upload' : 'Not requested',
  });
  pills.push({
    label: 'CC Auth',
    icon: '💳',
    state: paperwork?.creditCardAuth ? 'signed' : paperwork ? 'pending' : 'not-sent',
    detail: paperwork?.creditCardAuth ? 'Authorized' : paperwork ? 'Awaiting authorization' : 'Not requested',
  });

  return (
    <div className="grid grid-cols-2 gap-2">
      {pills.map((p) => {
        const tone =
          p.state === 'signed'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : p.state === 'pending'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-zinc-50 border-zinc-200 text-zinc-600';
        const dot =
          p.state === 'signed' ? 'bg-emerald-500' : p.state === 'pending' ? 'bg-amber-500' : 'bg-zinc-400';
        return (
          <div key={p.label} className={`p-3 rounded-xl border ${tone}`}>
            <div className="flex items-center gap-2">
              <span className="text-base opacity-80">{p.icon}</span>
              <div className="min-w-0">
                <div className="text-[12px] font-bold uppercase tracking-wider">{p.label}</div>
                <div className="text-[11px] mt-0.5 flex items-center gap-1.5 opacity-80">
                  <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                  {p.detail}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DetailsGrid({ booking }: { booking: any }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 grid grid-cols-2 gap-4">
      <KV label="Job Name" value={booking?.jobName} />
      <KV label="Production" value={booking?.productionName} />
      <KV label="Start" value={fDate(booking?.startDate)} />
      <KV label="End" value={fDate(booking?.endDate)} />
      <KV label="Agent" value={booking?.agent?.name} />
      <KV label="Priority" value={booking?.priority} />
      <KV label="Source" value={booking?.source} />
      <KV label="Created" value={fDate(booking?.createdAt)} />
      {booking?.confirmedAt && <KV label="Confirmed" value={fDate(booking.confirmedAt)} />}
      {booking?.returnedAt && <KV label="Returned" value={fDate(booking.returnedAt)} />}
    </div>
  );
}

function ClientBlock({ booking, portalAccesses, paperwork }: { booking: any; portalAccesses: any[]; paperwork: any }) {
  return (
    <div className="space-y-3">
      {booking?.company ? (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-1">Company</div>
          <div className="text-[14px] font-bold text-gray-900">{booking.company.name}</div>
          {booking.company.billingAddress && <div className="text-[11px] text-gray-600 mt-1 whitespace-pre-line">{booking.company.billingAddress}</div>}
          {booking.company.billingEmail && (
            <a href={`mailto:${booking.company.billingEmail}`} className="text-[11px] text-blue-600 hover:underline block mt-0.5">{booking.company.billingEmail}</a>
          )}
          {booking.company.billingPhone && <div className="text-[11px] text-gray-500 mt-0.5">{booking.company.billingPhone}</div>}
        </div>
      ) : (
        <EmptyState icon="🏢" text="No company on file." />
      )}

      {booking?.person ? (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-1">Primary Contact</div>
          <div className="text-[13px] font-semibold text-gray-900">{booking.person.firstName} {booking.person.lastName}</div>
          {booking.person.title && <div className="text-[10px] text-gray-400 mt-0.5">{booking.person.title}</div>}
          {booking.person.email && (
            <a href={`mailto:${booking.person.email}`} className="text-[11px] text-blue-600 hover:underline block">{booking.person.email}</a>
          )}
          {booking.person.phone && (
            <a href={`tel:${booking.person.phone}`} className="text-[11px] text-gray-500 hover:underline block">{booking.person.phone}</a>
          )}
        </div>
      ) : (
        <EmptyState icon="👤" text="No primary contact on file." />
      )}

      {booking?.referredBy && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-1">Referred By</div>
          <div className="text-[13px] font-semibold text-gray-900">{booking.referredBy.firstName} {booking.referredBy.lastName}</div>
          {booking.referredBy.email && (
            <a href={`mailto:${booking.referredBy.email}`} className="text-[11px] text-blue-600 hover:underline block">{booking.referredBy.email}</a>
          )}
        </div>
      )}

      {portalAccesses.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-2">Portal Access ({portalAccesses.length})</div>
          <div className="space-y-2">
            {portalAccesses.map((pa) => (
              <div key={pa.id} className="flex items-center justify-between gap-2 p-2 bg-gray-50 rounded-lg">
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
        </div>
      )}

      {paperwork?.token && (
        <div className="flex gap-2">
          <button
            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/client/${paperwork.token}`)}
            className="flex-1 py-2 rounded-lg text-[11px] font-semibold border text-gray-700 hover:bg-gray-50"
            style={{ borderColor: GOLD }}
          >
            Copy Dashboard Link
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/${paperwork.token}`)}
            className="flex-1 py-2 rounded-lg text-[11px] font-semibold hover:opacity-90"
            style={{ backgroundColor: GOLD, color: DARK }}
          >
            Copy Paperwork Link
          </button>
        </div>
      )}
    </div>
  );
}

function VehiclesBlock({ booking }: { booking: any }) {
  const orderLineItems = (booking?.orders || []).flatMap((o: any) => o.lineItems || []);
  const bookingItems = booking?.items || [];
  if (orderLineItems.length === 0 && bookingItems.length === 0) {
    return <EmptyState icon="🚛" text="No vehicles or equipment assigned yet. Add via the Order editor." />;
  }
  return (
    <div className="space-y-3">
      {bookingItems.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-1">Booking Items</div>
          {bookingItems.map((item: any) => (
            <div key={item.id} className="p-3 bg-gray-50 rounded-xl">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-[12px] font-semibold text-gray-900">{item.category?.name || 'Item'}</div>
                <div className="text-[11px] font-bold text-gray-700">×{item.quantity}</div>
              </div>
              <div className="text-[10px] text-gray-500">{fMoney(item.dailyRate)} / day · {item.status}</div>
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
      )}
      {orderLineItems.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-1">Order Line Items</div>
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
      )}
    </div>
  );
}

function FinancialsBlock({ booking }: { booking: any }) {
  const orderLineItems = (booking?.orders || []).flatMap((o: any) => o.lineItems || []);
  const lineItemTotal = orderLineItems.reduce((s: number, li: any) => s + Number(li.lineTotal || 0), 0);
  const hasFinancials = booking?.totalPrice || booking?.depositAmount || booking?.invoiceStatus || lineItemTotal > 0;
  if (!hasFinancials) {
    return <EmptyState icon="💰" text="No financials yet — totals appear once line items and quotes are added." />;
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
      {booking?.totalPrice && (
        <div className="flex justify-between items-center py-2 border-b border-gray-100">
          <span className="text-[12px] text-gray-600">Booking Total</span>
          <span className="text-[15px] font-extrabold text-gray-900">{fMoney(booking.totalPrice)}</span>
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
  );
}

function DispatchBlock({ booking }: { booking: any }) {
  const hasDispatchInfo = booking?.deliveryAddress || booking?.pickupAddress || (booking?.dispatchTasks?.length || 0) > 0;
  if (!hasDispatchInfo) {
    return <EmptyState icon="📍" text="No dispatch records yet. Delivery / pickup details appear once scheduled." />;
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      {booking.deliveryAddress && (
        <div className="p-3 bg-gray-50 rounded-xl">
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-1">📍 Delivery</div>
          <div className="text-[12px] font-semibold text-gray-900 whitespace-pre-line">{booking.deliveryAddress}</div>
          {booking.deliveryTime && <div className="text-[11px] text-gray-500 mt-0.5">{booking.deliveryTime}</div>}
        </div>
      )}
      {booking.pickupAddress && (
        <div className="p-3 bg-gray-50 rounded-xl">
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-1">🔁 Pickup</div>
          <div className="text-[12px] font-semibold text-gray-900 whitespace-pre-line">{booking.pickupAddress}</div>
          {booking.pickupTime && <div className="text-[11px] text-gray-500 mt-0.5">{booking.pickupTime}</div>}
        </div>
      )}
      {booking.dispatchTasks?.length > 0 && (
        <div className="space-y-1.5 mt-2">
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
      )}
    </div>
  );
}

function WarehouseBlock({ booking }: { booking: any }) {
  const items = booking?.items || [];
  const totalAssignments = items.reduce((s: number, i: any) => s + (i.assignments?.length || 0), 0);
  if (items.length === 0) {
    return <EmptyState icon="📦" text="No pick list yet — items appear here once line items are added." />;
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-1.5">
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
      <div className="pt-2 mt-2 border-t border-gray-100 flex justify-between text-[11px]">
        <span className="text-gray-500">Total assignments</span>
        <span className="font-bold text-gray-900">{totalAssignments}</span>
      </div>
    </div>
  );
}

function NotesBlock({ booking, role }: { booking: any; role: string }) {
  if (!booking.notes && !booking.adminNotes) {
    return <EmptyState icon="💬" text="No notes on this booking yet." />;
  }
  return (
    <div className="space-y-3">
      {booking.notes && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[9px] text-gray-400 uppercase font-bold tracking-wider mb-2">Job Notes</div>
          <p className="text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap">{booking.notes}</p>
        </div>
      )}
      {booking.adminNotes && role === 'ADMIN' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-2">Admin Notes</div>
          <p className="text-[12px] text-amber-800 leading-relaxed whitespace-pre-wrap">{booking.adminNotes}</p>
        </div>
      )}
    </div>
  );
}
