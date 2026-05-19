'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import CreateSendModal from '@/components/bookings/CreateSendModal';
import JobDashboard from '@/components/jobs/JobDashboard';

/**
 * Jobs page (/bookings). Reads native Neon `Booking` rows — replaces the
 * earlier RentalWorks-coupled view. Cards surface what a sales rep needs
 * at a glance: company + project, dates, contact, status, paperwork
 * progress, total value. Click a card → JobDashboard drawer for detail.
 *
 * Status chip palette tracks the BookingStatus enum in prisma/schema.prisma.
 * If the enum gains values, extend STATUS_CONFIG below — unknown statuses
 * fall back to a neutral grey badge.
 */

type PaperworkSnapshot = {
  token: string;
  contractType: string | null;
  rentalAgreement: boolean;
  lcdwAccepted: boolean;
  coiReceived: boolean;
  creditCardAuth: boolean;
  studioContractSigned: boolean;
  sentAt: string | null;
};

type RelatedCounts = {
  paperworkRequests: number;
  orders: number;
  dispatchTasks: number;
  insuranceClaims: number;
  signedAgreements: number;
  portalAccesses: number;
};

type BookingRow = {
  id: string;
  bookingNumber: string;
  status: string;
  jobName: string | null;
  productionName: string | null;
  startDate: string | null;
  endDate: string | null;
  totalPrice: number | string | null;
  createdAt: string;
  archivedAt: string | null;
  company: { name: string } | null;
  person: { firstName: string; lastName: string; email: string } | null;
  agent: { name: string } | null;
  paperworkRequests: PaperworkSnapshot[];
  relatedCounts?: RelatedCounts;
};

interface StatusConfig {
  label: string;
  badge: string;
  bar: string;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  REQUEST:          { label: 'Requested',  badge: 'bg-amber-50 text-amber-700 border-amber-200',     bar: '#fbbf24' },
  AI_REVIEW:        { label: 'AI Review',  badge: 'bg-violet-50 text-violet-700 border-violet-200',  bar: '#a78bfa' },
  PENDING_APPROVAL: { label: 'Pending',    badge: 'bg-orange-50 text-orange-700 border-orange-200',  bar: '#fb923c' },
  CONFIRMED:        { label: 'Confirmed',  badge: 'bg-blue-50 text-blue-700 border-blue-200',        bar: '#60a5fa' },
  ACTIVE:           { label: 'Active',     badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: '#34d399' },
  RETURNED:         { label: 'Returned',   badge: 'bg-zinc-100 text-zinc-700 border-zinc-200',       bar: '#a1a1aa' },
  CANCELLED:        { label: 'Cancelled',  badge: 'bg-red-50 text-red-700 border-red-200',           bar: '#fca5a5' },
  ARCHIVED:         { label: 'Archived',   badge: 'bg-zinc-50 text-zinc-500 border-zinc-200',        bar: '#d4d4d8' },
};

const STATUS_ORDER = ['REQUEST', 'AI_REVIEW', 'PENDING_APPROVAL', 'CONFIRMED', 'ACTIVE', 'RETURNED', 'CANCELLED', 'ARCHIVED'];

function fmtDateRange(start: string | null, end: string | null): string {
  if (!start) return 'Dates TBD';
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (!end || start === end) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMoney(value: number | string | null): string | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n as number) || (n as number) <= 0) return null;
  return (n as number).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function BookingsPage() {
  const { data: session } = useSession();
  const sessionUser = session?.user as { name?: string; firstName?: string } | undefined;
  const agentName = sessionUser?.name || sessionUser?.firstName || '';

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showArchived, setShowArchived] = useState(false);
  const [showCreateSend, setShowCreateSend] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerNumber, setDrawerNumber] = useState('');
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  // Archive confirmation modal — null = not open; the booking row is
  // the subject and source of the linked-data warning.
  const [archiveTarget, setArchiveTarget] = useState<BookingRow | null>(null);
  const [archiving, setArchiving] = useState(false);

  const reload = (archived = showArchived) => {
    setLoading(true);
    fetch(`/api/bookings/list${archived ? '?archived=1' : ''}`)
      .then((r) => r.json())
      .then((data) => setBookings(Array.isArray(data.bookings) ? data.bookings : []))
      .catch(() => setBookings([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload(showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const archive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/bookings/${archiveTarget.id}/archive`, { method: 'POST' });
      if (res.ok) {
        setArchiveTarget(null);
        reload(showArchived);
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Archive failed');
      }
    } finally {
      setArchiving(false);
    }
  };

  const restore = async (id: string) => {
    const res = await fetch(`/api/bookings/${id}/restore`, { method: 'POST' });
    if (res.ok) reload(showArchived);
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Restore failed');
    }
  };

  // Counts per status — used to label the chip filters.
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: bookings.length };
    for (const b of bookings) c[b.status] = (c[b.status] || 0) + 1;
    return c;
  }, [bookings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      if (!q) return true;
      const project = b.productionName || b.jobName || '';
      const personName = b.person ? `${b.person.firstName} ${b.person.lastName}` : '';
      return (
        b.company?.name?.toLowerCase().includes(q) ||
        project.toLowerCase().includes(q) ||
        personName.toLowerCase().includes(q) ||
        b.person?.email?.toLowerCase().includes(q) ||
        b.bookingNumber.toLowerCase().includes(q)
      );
    });
  }, [bookings, statusFilter, search]);

  // Only render chips for statuses that exist in the data, plus REQUEST (so
  // the default state still shows a useful filter when the DB is empty).
  const visibleChips = useMemo(() => {
    const present = new Set<string>(['REQUEST']);
    for (const b of bookings) present.add(b.status);
    return STATUS_ORDER.filter((s) => present.has(s));
  }, [bookings]);

  return (
    <div>
      <JobDashboard orderId={drawerId} orderNumber={drawerNumber} onClose={() => setDrawerId(null)} />

      {/* Header */}
      <div className="flex items-end justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Jobs</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {loading
              ? 'Loading…'
              : bookings.length === 1
                ? '1 job'
                : `${bookings.length} jobs`}
          </p>
        </div>
        <button
          onClick={() => setShowCreateSend(true)}
          className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-[12px] font-bold transition-colors"
        >
          + Create &amp; Send Portal
        </button>
      </div>

      {/* Status chips */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => setStatusFilter('ALL')}
          className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
            statusFilter === 'ALL'
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
          }`}
        >
          All <span className="opacity-70 ml-1">{counts.ALL || 0}</span>
        </button>
        {visibleChips.map((s) => {
          const cfg = STATUS_CONFIG[s];
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(active ? 'ALL' : s)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
                active ? 'bg-gray-900 text-white border-gray-900' : `${cfg.badge} hover:border-gray-400`
              }`}
            >
              {cfg.label} <span className="opacity-70 ml-1">{counts[s] || 0}</span>
            </button>
          );
        })}
        {/* Archived toggle — sits at the end of the chip row so the
            default "live" set stays the natural left-hand emphasis. */}
        <span className="mx-1 text-gray-200">|</span>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
            showArchived
              ? 'bg-zinc-900 text-white border-zinc-900'
              : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400'
          }`}
        >
          {showArchived ? '↩ Back to active' : '🗄 Show archived'}
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, project, contact, or job #…"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:border-gray-400"
        />
      </div>

      {/* Results */}
      {loading ? (
        <div className="text-center py-20 text-gray-400 text-[13px]">Loading jobs…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-[13px]">
            {bookings.length === 0
              ? 'No jobs yet. Click + Create & Send Portal to start one.'
              : 'No jobs match your filters.'}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((b) => (
            <JobCard
              key={b.id}
              booking={b}
              onOpenDrawer={() => {
                setDrawerNumber(b.bookingNumber);
                setDrawerId(b.id);
              }}
              copied={copiedFor === b.id}
              onCopyPortal={() => {
                const token = b.paperworkRequests?.[0]?.token;
                if (!token) return;
                const url = `${window.location.origin}/portal/${token}`;
                navigator.clipboard.writeText(url);
                setCopiedFor(b.id);
                setTimeout(() => setCopiedFor(null), 1500);
              }}
              onArchive={() => setArchiveTarget(b)}
              onRestore={() => restore(b.id)}
            />
          ))}
        </div>
      )}

      {/* Archive confirmation modal */}
      {archiveTarget && (
        <ArchiveConfirmModal
          booking={archiveTarget}
          busy={archiving}
          onCancel={() => setArchiveTarget(null)}
          onConfirm={archive}
        />
      )}

      {showCreateSend && (
        <CreateSendModal
          onClose={() => {
            setShowCreateSend(false);
            reload();
          }}
          agentId={undefined}
          agentName={agentName}
        />
      )}
    </div>
  );
}

/**
 * Single job card. Stacks: header (company + status badge) → project →
 * date range → contact → paperwork checks → footer (total + actions).
 * Click anywhere outside the action buttons opens the JobDashboard drawer.
 */
function JobCard({
  booking,
  onOpenDrawer,
  onCopyPortal,
  copied,
  onArchive,
  onRestore,
}: {
  booking: BookingRow;
  onOpenDrawer: () => void;
  onCopyPortal: () => void;
  copied: boolean;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const cfg = STATUS_CONFIG[booking.status] ?? STATUS_CONFIG.ARCHIVED;
  const projectName = booking.productionName || booking.jobName || '(no project name)';
  const personFullName = booking.person ? `${booking.person.firstName} ${booking.person.lastName}` : null;
  const total = fmtMoney(booking.totalPrice ?? null);
  const pw = booking.paperworkRequests?.[0] ?? null;
  const isArchived = !!booking.archivedAt;

  const portalToken = pw?.token ?? null;
  const portalUrl = portalToken ? `/portal/${portalToken}` : null;

  return (
    <div
      onClick={onOpenDrawer}
      className={`group relative bg-white rounded-xl border p-4 hover:shadow-md transition-all cursor-pointer flex flex-col gap-2.5 active:scale-[0.995] ${
        isArchived ? 'border-gray-200 opacity-70 hover:opacity-95' : 'border-gray-200 hover:border-gray-300'
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: cfg.bar }}
    >
      {/* Archive / restore affordance — hover-revealed (still visible
          on touch via the always-mounted action menu inside cards). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          isArchived ? onRestore() : onArchive();
        }}
        title={isArchived ? 'Restore booking' : 'Archive booking'}
        aria-label={isArchived ? 'Restore booking' : 'Archive booking'}
        className={`absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-semibold border transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100 ${
          isArchived
            ? 'bg-white border-blue-200 text-blue-600 hover:bg-blue-50'
            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
        }`}
      >
        {isArchived ? 'Restore' : 'Archive'}
      </button>
      {/* Header row — job name is the primary identifier; company sits
          below as context. Booking number moves out of the meta row
          (it's an internal id; the drawer surfaces it for ops). */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-gray-900 truncate">{projectName}</div>
          <div className="text-[11px] text-gray-500 truncate">{booking.company?.name || 'Unknown company'}</div>
        </div>
        <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${cfg.badge} flex-shrink-0`}>
          {cfg.label}
        </span>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
        <span>{fmtDateRange(booking.startDate, booking.endDate)}</span>
        {booking.agent?.name && (
          <>
            <span>·</span>
            <span>{booking.agent.name}</span>
          </>
        )}
      </div>

      {/* Contact + paperwork */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          {personFullName ? (
            <>
              <div className="text-[11px] font-semibold text-gray-700 truncate">{personFullName}</div>
              {booking.person?.email && (
                <a
                  href={`mailto:${booking.person.email}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] text-gray-500 hover:text-gray-800 truncate block"
                >
                  {booking.person.email}
                </a>
              )}
            </>
          ) : (
            <div className="text-[10px] text-gray-400">No contact on file</div>
          )}
        </div>
        {pw && <PaperworkBadges pw={pw} />}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100 mt-1">
        <div className="text-[11px] text-gray-400">
          {isArchived ? (
            <span className="text-zinc-500">archived {fmtRelative(booking.archivedAt!)}</span>
          ) : (
            <>created {fmtRelative(booking.createdAt)}</>
          )}
        </div>
        <div className="flex items-center gap-2">
          {total && <span className="text-[12px] font-bold text-emerald-700">{total}</span>}
          {portalUrl && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCopyPortal();
              }}
              className="text-[10px] font-semibold text-gray-500 hover:text-gray-800 px-2 py-1 rounded border border-gray-200 hover:border-gray-400"
            >
              {copied ? '✓ Copied' : 'Copy Link'}
            </button>
          )}
          {portalUrl && (
            <a
              href={portalUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] font-semibold text-gray-700 hover:text-gray-900 px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
            >
              View Portal →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Tiny check/dot badges representing paperwork completion. Only renders
 * when a paperworkRequest snapshot exists on the booking. Contract type
 * controls which checks are surfaced — stage bookings need the studio
 * contract signed, vehicles need rental agreement + LCDW, both need COI.
 */
function PaperworkBadges({ pw }: { pw: PaperworkSnapshot }) {
  const isStage = pw.contractType === 'stage' || pw.contractType === 'both';
  const isVehicles = !pw.contractType || pw.contractType === 'vehicles' || pw.contractType === 'both';
  const checks: { label: string; ok: boolean }[] = [];
  if (isVehicles) checks.push({ label: 'RA', ok: pw.rentalAgreement });
  if (isStage) checks.push({ label: 'Stage', ok: pw.studioContractSigned });
  checks.push({ label: 'COI', ok: pw.coiReceived });

  return (
    <div className="flex items-center gap-1 flex-shrink-0" title="Paperwork progress">
      {checks.map((c) => (
        <span
          key={c.label}
          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
            c.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'
          }`}
        >
          {c.ok ? '✓' : '○'} {c.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Confirmation modal for booking archive. Surfaces the linked-row
 * counts so the rep knows what's about to be hidden — none of these
 * rows get deleted, but the booking is the entry point, so this is
 * what "hidden" means in practice. Restore zeroes archivedAt and
 * everything reappears.
 */
function ArchiveConfirmModal({
  booking,
  busy,
  onCancel,
  onConfirm,
}: {
  booking: BookingRow;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const projectName = booking.productionName || booking.jobName || `Booking ${booking.bookingNumber}`;
  const c = booking.relatedCounts;
  const warnings: string[] = [];
  if (c) {
    if (c.signedAgreements > 0) warnings.push(`${c.signedAgreements} signed agreement${c.signedAgreements === 1 ? '' : 's'}`);
    if (c.portalAccesses > 0) warnings.push(`${c.portalAccesses} portal access${c.portalAccesses === 1 ? '' : 'es'}`);
    if (c.paperworkRequests > 0) warnings.push(`${c.paperworkRequests} paperwork request${c.paperworkRequests === 1 ? '' : 's'}`);
    if (c.dispatchTasks > 0) warnings.push(`${c.dispatchTasks} dispatch task${c.dispatchTasks === 1 ? '' : 's'}`);
    if (c.insuranceClaims > 0) warnings.push(`${c.insuranceClaims} insurance claim${c.insuranceClaims === 1 ? '' : 's'}`);
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:top-1/2 sm:w-[480px] z-50 bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="text-base font-bold text-gray-900">Archive booking?</div>
        </div>
        <div className="px-5 py-4 space-y-3 text-[13px] text-gray-700 leading-relaxed">
          <p>
            Archive <span className="font-semibold text-gray-900">{projectName}</span>?
            It will be hidden from the Jobs page. You can restore it any time
            from the &ldquo;Show archived&rdquo; view.
          </p>
          {warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[12px] text-amber-800">
              This booking has {warnings.join(', ')}. They will be hidden along with the booking but stay readable via direct links and restore.
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {busy ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </div>
    </>
  );
}
