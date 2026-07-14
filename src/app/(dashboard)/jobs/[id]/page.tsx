'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { JobEmailThreads } from '@/components/jobs/JobEmailThreads';
import { ProductionTypeProfilePicker } from '@/components/productionTypeProfiles/ProductionTypeProfilePicker';
import { CopyCoiLinkButton } from '@/components/coi/CopyCoiLinkButton';

const JOB_STATUSES = ['QUOTED', 'ACTIVE', 'WRAPPED', 'HOLD', 'LOST'] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

const STATUS_BADGE: Record<JobStatus, string> = {
  QUOTED:  'bg-purple-900/40 text-purple-300 border-purple-800',
  ACTIVE:  'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  WRAPPED: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  HOLD:    'bg-amber-900/40 text-amber-300 border-amber-800',
  LOST:    'bg-red-900/40 text-red-300 border-red-800',
};

const ORDER_STATUS_BADGE: Record<string, string> = {
  DRAFT:      'bg-zinc-800 text-zinc-400',
  QUOTE_SENT: 'bg-blue-900/40 text-blue-300',
  CONFIRMED:  'bg-amber-900/40 text-amber-300',
  ACTIVE:     'bg-emerald-900/40 text-emerald-300',
  RETURNED:   'bg-purple-900/40 text-purple-300',
  CLOSED:     'bg-zinc-800 text-zinc-500',
  CANCELLED:  'bg-red-900/40 text-red-300',
};

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface JobContact {
  id: string;
  role: string;
  isPrimary: boolean;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
}

// Phase 7 Pass A — expanded order payload on the Job page.
interface OrderLineItem {
  id: string;
  sortOrder: number;
  type: string;
  department: string;
  description: string;
  quantity: number;
  rate: number;
  billableDays: number;
  lineTotal: number;
  pickupDate: string | null;
  returnDate: string | null;
  fulfillmentLane: 'FLEET' | 'WAREHOUSE' | 'STAGE' | null;
  pickStatus: 'PENDING_PICK' | 'PICKED' | 'STAGED' | 'LOADED' | null;
  qualifier: string | null;
  notes: string | null;
  inventoryItem: { code: string; description: string | null } | null;
  assetCategory: { name: string; slug: string } | null;
}

interface OrderSignedAgreement {
  id: string;
  contractType: string;
  status: string;
  signedAt: string | null;
  signerName: string | null;
  updatedAt: string;
}

interface OrderInvoice {
  id: string;
  invoiceNumber: string;
  type: 'RENTAL' | 'LD';
  status: 'DRAFT' | 'SENT' | 'PAID' | 'PARTIAL' | 'VOID';
  total: number;
  amountPaid: number;
  balanceDue: number;
  sentAt: string | null;
  paidAt: string | null;
  dueDate: string | null;
  createdAt: string;
}

interface OrderStageBookingTerms {
  id: string;
  rentalDates: unknown; // JSON array of YYYY-MM-DD strings
  dailyRate: number;
  productionOfficeRental: boolean;
  specificSpaces: string[];
  securityGuardRequired: boolean;
  salesNotes: string | null;
}

interface JobOrder {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  total: number;
  bookedTotal: number | null;
  fleetReadyAt: string | null;
  notes: string | null;
  lineItems: OrderLineItem[];
  signedAgreements: OrderSignedAgreement[];
  invoices: OrderInvoice[];
  stageBookingTerms: OrderStageBookingTerms | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  // Phase 1b — set on Orders created via the inquiry add-on triage
  // path. Drives the "Add-on" chip on this row.
  addedToJobAt: string | null;
}

interface JobDetail {
  id: string;
  jobCode: string;
  name: string;
  status: JobStatus;
  productionType: string;
  productionTypeProfileId: string | null;
  startDate: string | null;
  endDate: string | null;
  estimatedValue: number | null;
  orderTotal: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string };
  agent: { id: string; name: string; email: string };
  jobContacts: JobContact[];
  orders: JobOrder[];
  bookings: JobBooking[];
  activity: ActivityRow[];
  fromInquiry: {
    id: string;
    source: 'MANUAL' | 'GMAIL' | 'WEB_FORM';
    createdAt: string;
    title: string;
  } | null;
}

interface JobBooking {
  id: string;
  bookingNumber: string;
  startDate: string;
  endDate: string;
  status: string;
  items: Array<{
    id: string;
    quantity: number;
    holdRank: number;
    category: { id: string; name: string; slug: string };
    assignments: Array<{
      id: string;
      startDate: string;
      endDate: string;
      status: 'ASSIGNED' | 'CHECKED_OUT' | 'RETURNED' | 'SWAPPED';
      asset: { id: string; unitName: string };
    }>;
  }>;
}

interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}

// Compact relative-time formatter for the provenance line. "today" for
// <24h, "Nd ago" up to 30 days, "Nw ago" up to ~3mo, then absolute month.
function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const ms = Date.now() - then;
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 90) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

const INQUIRY_SOURCE_BADGE: Record<'MANUAL' | 'GMAIL' | 'WEB_FORM', string> = {
  MANUAL:   'bg-zinc-800 text-zinc-400 border-zinc-700',
  GMAIL:    'bg-rose-950/40 text-rose-300 border-rose-900',
  WEB_FORM: 'bg-sky-950/40 text-sky-300 border-sky-900',
};

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusSaving, setStatusSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  // Phase 7 Pass B — inline scope expander. Collapsed by default;
  // click the row to expand the full booked-scope panel.
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const toggleOrder = (oid: string) =>
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      next.has(oid) ? next.delete(oid) : next.add(oid);
      return next;
    });

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/jobs/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.job) {
          setJob(d.job);
          setNotes(d.job.notes || '');
          setNotesDirty(false);
        } else {
          setError(d.error || 'Job not found');
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const updateStatus = async (status: JobStatus) => {
    if (!job) return;
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setStatusSaving(false);
    }
  };

  const saveNotes = async () => {
    setNotesSaving(true);
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error('Failed to save notes');
      setNotesDirty(false);
      if (job) setJob({ ...job, notes });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save notes');
    } finally {
      setNotesSaving(false);
    }
  };

  // PATCH the Job's productionTypeProfileId. Server fires the
  // Company most-common-profile cache-refresh after the update.
  const saveProfile = async (nextId: string | null) => {
    if (!job) return;
    setProfileSaving(true);
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productionTypeProfileId: nextId }),
      });
      if (!res.ok) throw new Error('Failed to save profile');
      setJob({ ...job, productionTypeProfileId: nextId });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <div className="text-zinc-400 text-sm">{error || 'Job not found'}</div>
        <button
          onClick={() => router.back()}
          className="text-xs text-amber-500 hover:text-amber-400"
        >
          ← Back
        </button>
      </div>
    );
  }

  const dealValue = job.orderTotal > 0 ? job.orderTotal : job.estimatedValue;
  const dealValueLabel =
    job.orderTotal > 0 ? 'Order Total' : job.estimatedValue != null ? 'Estimated' : '—';

  // Phase 7 Pass A — at-a-glance engagement rollup. All derived from
  // the expanded payload; no extra API call.
  const liveOrders = job.orders.filter((o) => o.status !== 'CANCELLED');
  const rentalAgreement = liveOrders
    .flatMap((o) => o.signedAgreements)
    .find((a) => a.contractType === 'RENTAL_AGREEMENT');
  const stageAgreement = liveOrders
    .flatMap((o) => o.signedAgreements)
    .find((a) => a.contractType === 'STAGE_CONTRACT');
  const agreementStatus =
    rentalAgreement?.status === 'SIGNED_BASELINE' || rentalAgreement?.status === 'SIGNED_NEGOTIATED'
      ? 'signed'
      : rentalAgreement
        ? 'pending'
        : 'none';
  // Invoices: sum of balanceDue across active (non-VOID) RENTAL + LD invoices.
  const liveInvoices = liveOrders.flatMap((o) => o.invoices).filter((i) => i.status !== 'VOID');
  const totalBalanceDue = liveInvoices.reduce((s, i) => s + i.balanceDue, 0);
  const totalInvoiced = liveInvoices.reduce((s, i) => s + i.total, 0);
  // Loaded-ready rollup: count BOOKED-or-past orders that have reached
  // LOADED_READY (or later). Skips CANCELLED + un-booked.
  const fulfillmentReady = liveOrders.filter((o) =>
    ['LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED'].includes(o.status),
  ).length;
  const fulfillmentTotal = liveOrders.filter((o) =>
    ['BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED'].includes(o.status),
  ).length;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <button
        onClick={() => router.back()}
        className="text-xs text-zinc-500 hover:text-zinc-300"
      >
        ← Back
      </button>

      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono text-zinc-500">{job.jobCode}</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${STATUS_BADGE[job.status]}`}
              >
                {job.status}
              </span>
            </div>
            <h1 className="text-2xl font-semibold text-white mt-1 truncate">{job.name}</h1>
            <Link
              href={`/crm/${job.company.id}`}
              className="text-sm text-zinc-400 hover:text-amber-500"
            >
              {job.company.name}
            </Link>
            {job.fromInquiry && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span>Originated from</span>
                <Link
                  href={`/inquiries/${job.fromInquiry.id}`}
                  className="text-zinc-400 hover:text-amber-500 underline-offset-2 hover:underline"
                >
                  Inquiry
                </Link>
                <span className="text-zinc-700">·</span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${INQUIRY_SOURCE_BADGE[job.fromInquiry.source]}`}
                >
                  {job.fromInquiry.source.replace('_', ' ')}
                </span>
                <span className="text-zinc-700">·</span>
                <span>captured {relativeAge(job.fromInquiry.createdAt)}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <label className="text-[10px] font-semibold uppercase text-zinc-500">Status</label>
            <select
              value={job.status}
              disabled={statusSaving}
              onChange={(e) => updateStatus(e.target.value as JobStatus)}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500 disabled:opacity-50"
            >
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <CopyCoiLinkButton jobId={job.id} variant="dark" />
          </div>
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Meta label="Production Type" value={job.productionType.replace('_', ' ')} />
          <Meta label="Start" value={fmtDate(job.startDate)} />
          <Meta label="End" value={fmtDate(job.endDate)} />
          <Meta label="Agent" value={job.agent?.name || '—'} />
          <Meta label="Deal Value" value={fmtMoney(dealValue)} sub={dealValueLabel} />
          <Meta label="Orders" value={String(job.orders.length)} />
          <Meta label="Created" value={fmtDate(job.createdAt)} />
          <Meta label="Updated" value={fmtDate(job.updatedAt)} />
        </div>

        {/* Phase 7 Pass A — at-a-glance engagement rollup. Each chip
            is computed from the expanded payload (no extra fetches).
            Hidden when the job has zero non-cancelled orders — the
            chips read as garbage during the QUOTED-no-order phase. */}
        {liveOrders.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
            <RollupChip
              label="Rental agreement"
              value={
                agreementStatus === 'signed'
                  ? 'Signed'
                  : agreementStatus === 'pending'
                    ? rentalAgreement?.status.replace(/_/g, ' ') || 'Pending'
                    : 'None'
              }
              tone={agreementStatus === 'signed' ? 'good' : agreementStatus === 'pending' ? 'warn' : 'idle'}
            />
            {stageAgreement && (
              <RollupChip
                label="Stage agreement"
                value={
                  stageAgreement.status === 'SIGNED_BASELINE' || stageAgreement.status === 'SIGNED_NEGOTIATED'
                    ? 'Signed'
                    : stageAgreement.status.replace(/_/g, ' ')
                }
                tone={
                  stageAgreement.status === 'SIGNED_BASELINE' || stageAgreement.status === 'SIGNED_NEGOTIATED'
                    ? 'good'
                    : 'warn'
                }
              />
            )}
            {liveInvoices.length > 0 && (
              <RollupChip
                label="Balance due"
                value={totalBalanceDue > 0 ? fmtMoney(totalBalanceDue) : 'Paid in full'}
                sub={totalInvoiced > 0 ? `of ${fmtMoney(totalInvoiced)}` : undefined}
                tone={totalBalanceDue > 0 ? 'warn' : 'good'}
              />
            )}
            {fulfillmentTotal > 0 && (
              <RollupChip
                label="Loaded ready"
                value={`${fulfillmentReady} of ${fulfillmentTotal}`}
                sub="orders"
                tone={fulfillmentReady === fulfillmentTotal ? 'good' : 'warn'}
              />
            )}
          </div>
        )}

        {/* Production type profile — drives the fleet-assignment
            optimizer. Editable in place; saving triggers the Company
            most-common-profile cache refresh on the server. The legacy
            productionType enum stays in the Meta grid above as static
            display until the writers cut over. */}
        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Production type profile
          </div>
          <div className="w-64">
            <ProductionTypeProfilePicker
              value={job.productionTypeProfileId}
              onChange={(id) => { void saveProfile(id); }}
              disabled={profileSaving}
              size="compact"
            />
          </div>
          {profileSaving && <span className="text-[10px] text-zinc-500">Saving…</span>}
        </div>
      </div>

      {/* Contacts — Phase 7 Pass A: surface phone (already fetched,
          previously not rendered) so the agent can reach the client
          after-hours via a single tap. tel: link triggers native
          dialer on mobile / Mac Continuity Calling on desktop. */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Contacts</h2>
        {job.jobContacts.length === 0 ? (
          <div className="text-sm text-zinc-500">No contacts yet.</div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {job.jobContacts.map((jc) => (
              <div key={jc.id} className="flex items-center justify-between py-2.5 gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">
                    {jc.person.firstName} {jc.person.lastName}
                    {jc.isPrimary && (
                      <span className="ml-2 text-[10px] font-bold text-amber-500 uppercase">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 truncate flex items-center gap-3 flex-wrap">
                    {jc.person.email && (
                      <a href={`mailto:${jc.person.email}`} className="hover:text-amber-500">
                        {jc.person.email}
                      </a>
                    )}
                    {jc.person.phone && (
                      <a
                        href={`tel:${jc.person.phone.replace(/[^\d+]/g, '')}`}
                        className="text-zinc-400 hover:text-amber-500 font-mono"
                      >
                        {jc.person.phone}
                      </a>
                    )}
                  </div>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 bg-zinc-800 px-2 py-1 rounded">
                  {jc.role}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Logistics & after-hours — Phase 7 Pass B. Aggregates the
          per-order delivery/pickup arrangements an agent needs at a
          glance: order.notes (free-text — where after-hours dropoff
          instructions live today), stageBookingTerms.salesNotes, and
          any line items whose pickupDate/returnDate diverges from the
          order window. Hidden when no order has logistics data. */}
      {(() => {
        const rows = liveOrders
          .map((o) => {
            const dateOverrides = o.lineItems.filter(
              (li) =>
                (li.pickupDate && li.pickupDate !== o.startDate) ||
                (li.returnDate && li.returnDate !== o.endDate),
            );
            const hasNotes = !!(o.notes && o.notes.trim());
            const hasStageNotes = !!(o.stageBookingTerms?.salesNotes && o.stageBookingTerms.salesNotes.trim());
            const hasStageDetail = !!o.stageBookingTerms;
            if (!hasNotes && !hasStageNotes && !hasStageDetail && dateOverrides.length === 0) return null;
            return { order: o, dateOverrides, hasNotes, hasStageNotes, hasStageDetail };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (rows.length === 0) return null;

        return (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Logistics & after-hours</h2>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Free-text from agent notes + stage terms</span>
            </div>
            <div className="space-y-4">
              {rows.map(({ order, dateOverrides, hasNotes, hasStageNotes, hasStageDetail }) => (
                <div key={order.id} className="border-l-2 border-amber-900/40 pl-3">
                  <div className="flex items-center gap-2 mb-1.5 text-[11px]">
                    <Link
                      href={`/orders/${order.id}`}
                      className="font-mono text-zinc-300 hover:text-amber-400"
                    >
                      {order.orderNumber}
                    </Link>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${ORDER_STATUS_BADGE[order.status] || 'bg-zinc-800 text-zinc-400'}`}
                    >
                      {order.status}
                    </span>
                    <span className="text-zinc-500">
                      {fmtDate(order.startDate)} – {fmtDate(order.endDate)}
                    </span>
                  </div>
                  {hasNotes && (
                    <div className="mb-2">
                      <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mb-0.5">Order notes</div>
                      <div className="text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed">{order.notes}</div>
                    </div>
                  )}
                  {hasStageDetail && order.stageBookingTerms && (
                    <div className="mb-2">
                      <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mb-0.5">Stage terms</div>
                      <div className="text-xs text-zinc-300 flex flex-wrap gap-x-3 gap-y-0.5">
                        {order.stageBookingTerms.specificSpaces?.length > 0 && (
                          <span>Spaces: <span className="text-zinc-100">{order.stageBookingTerms.specificSpaces.join(', ')}</span></span>
                        )}
                        {order.stageBookingTerms.productionOfficeRental && (
                          <span className="text-amber-300">+ Production office</span>
                        )}
                        {order.stageBookingTerms.securityGuardRequired && (
                          <span className="text-amber-300">+ Security guard</span>
                        )}
                        <span>Daily: <span className="font-mono text-zinc-100">{fmtMoney(order.stageBookingTerms.dailyRate)}</span></span>
                      </div>
                      {hasStageNotes && order.stageBookingTerms.salesNotes && (
                        <div className="mt-1 text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed">{order.stageBookingTerms.salesNotes}</div>
                      )}
                    </div>
                  )}
                  {dateOverrides.length > 0 && (
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mb-0.5">Off-window pickup / return</div>
                      <ul className="text-xs text-zinc-300 space-y-0.5">
                        {dateOverrides.map((li) => (
                          <li key={li.id} className="flex gap-2">
                            <span className="text-zinc-500 min-w-[1rem]">·</span>
                            <span className="flex-1">
                              <span className="text-zinc-100">{li.description}</span>
                              <span className="ml-2 text-zinc-500">
                                {li.pickupDate ? fmtDate(li.pickupDate) : '—'} → {li.returnDate ? fmtDate(li.returnDate) : '—'}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Orders — Phase 7 Pass B: collapsible cards. Click the row to
          expand the booked scope, signed agreements, invoices, and any
          per-vehicle BookingAssignments. Affordances (edit, send, sign,
          invoice, payment) live on /orders/[id] — this is read-only
          rollup for the live engagement. */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Orders</h2>
          <span className="text-xs text-zinc-500">{job.orders.length} total · click to expand scope</span>
        </div>
        {job.orders.length === 0 ? (
          <div className="text-sm text-zinc-500">No orders on this job yet.</div>
        ) : (
          <div className="space-y-2">
            {job.orders.map((o) => {
              const expanded = expandedOrders.has(o.id);
              const orderBookings = job.bookings.filter(
                (b) => b.items.some((bi) => o.lineItems.some((li) => li.assetCategory?.slug === bi.category.slug)),
              );
              return (
                <div key={o.id} className="bg-zinc-950/40 border border-zinc-800 rounded-lg">
                  <button
                    onClick={() => toggleOrder(o.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-900/50 transition-colors"
                  >
                    <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
                    <span className="font-mono text-xs text-zinc-300">{o.orderNumber}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${ORDER_STATUS_BADGE[o.status] || 'bg-zinc-800 text-zinc-400'}`}
                    >
                      {o.status}
                    </span>
                    {o.addedToJobAt && (
                      <span
                        title="Added later via inquiry triage"
                        className="text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider bg-zinc-800 text-zinc-400 border border-zinc-700"
                      >
                        Add-on
                      </span>
                    )}
                    <span className="text-xs text-zinc-400 whitespace-nowrap">
                      {fmtDate(o.startDate)} – {fmtDate(o.endDate)}
                    </span>
                    <span className="text-[10px] text-zinc-500 ml-2">
                      {o.lineItems.length} line{o.lineItems.length === 1 ? '' : 's'}
                    </span>
                    <span className="ml-auto font-mono text-xs text-zinc-200">{fmtMoney(o.total)}</span>
                    <Link
                      href={`/orders/${o.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-amber-500 hover:text-amber-400 ml-2"
                    >
                      Open →
                    </Link>
                  </button>

                  {expanded && (
                    <div className="border-t border-zinc-800 px-4 py-3 space-y-4">
                      {/* Booked scope */}
                      {o.lineItems.length > 0 && (
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">Booked scope</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-[9px] uppercase tracking-wider text-zinc-500">
                                <tr className="border-b border-zinc-800">
                                  <th className="text-left pb-1.5 pr-2 font-semibold">Item</th>
                                  <th className="text-right pb-1.5 pr-2 font-semibold">Qty</th>
                                  <th className="text-right pb-1.5 pr-2 font-semibold">Days</th>
                                  <th className="text-right pb-1.5 pr-2 font-semibold">Rate</th>
                                  <th className="text-right pb-1.5 pr-2 font-semibold">Total</th>
                                  <th className="text-left pb-1.5 pl-2 font-semibold">Lane / Pick</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-900">
                                {o.lineItems.map((li) => (
                                  <tr key={li.id} className="text-zinc-300">
                                    <td className="py-1.5 pr-2">
                                      <div className="text-zinc-100">{li.description}</div>
                                      {li.qualifier && (
                                        <div className="text-[10px] text-zinc-500">{li.qualifier}</div>
                                      )}
                                    </td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{li.quantity}</td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{li.billableDays}</td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{fmtMoney(li.rate)}</td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{fmtMoney(li.lineTotal)}</td>
                                    <td className="py-1.5 pl-2 text-[10px]">
                                      {li.fulfillmentLane && (
                                        <span className="text-zinc-400 uppercase tracking-wider mr-2">{li.fulfillmentLane}</span>
                                      )}
                                      {li.pickStatus && (
                                        <span className="text-amber-300 uppercase tracking-wider">{li.pickStatus.replace(/_/g, ' ')}</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Per-vehicle assignments — only if a Booking
                          for this order's categories has assignments. */}
                      {orderBookings.some((b) => b.items.some((bi) => bi.assignments.length > 0)) && (
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">Per-vehicle assignments</div>
                          <ul className="text-xs text-zinc-300 space-y-0.5">
                            {orderBookings.flatMap((b) =>
                              b.items.flatMap((bi) =>
                                bi.assignments.map((a) => (
                                  <li key={a.id} className="flex gap-2">
                                    <span className="text-zinc-500 min-w-[1rem]">·</span>
                                    <span>
                                      <span className="text-zinc-100">{bi.category.name}</span>
                                      <span className="ml-2 font-mono text-amber-300">{a.asset.unitName}</span>
                                      <span className="ml-2 text-zinc-500">
                                        {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
                                      </span>
                                      <span className="ml-2 text-[9px] uppercase tracking-wider text-zinc-500">{a.status.replace(/_/g, ' ')}</span>
                                    </span>
                                  </li>
                                )),
                              ),
                            )}
                          </ul>
                        </div>
                      )}

                      {/* Signed agreements */}
                      {o.signedAgreements.length > 0 && (
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">Agreements</div>
                          <ul className="text-xs text-zinc-300 space-y-0.5">
                            {o.signedAgreements.map((a) => (
                              <li key={a.id} className="flex gap-2">
                                <span className="text-zinc-500 min-w-[1rem]">·</span>
                                <span>
                                  <span className="text-zinc-100">{a.contractType.replace(/_/g, ' ')}</span>
                                  <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-300">
                                    {a.status.replace(/_/g, ' ')}
                                  </span>
                                  {a.signedAt && (
                                    <span className="ml-2 text-zinc-500">
                                      signed {fmtDate(a.signedAt)}
                                      {a.signerName ? ` · ${a.signerName}` : ''}
                                    </span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Invoices */}
                      {o.invoices.length > 0 && (
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">Invoices</div>
                          <ul className="text-xs text-zinc-300 space-y-0.5">
                            {o.invoices.map((inv) => (
                              <li key={inv.id} className="flex gap-2">
                                <span className="text-zinc-500 min-w-[1rem]">·</span>
                                <span className="flex-1">
                                  <span className="font-mono text-zinc-100">{inv.invoiceNumber}</span>
                                  <span className="ml-1.5 text-[9px] text-zinc-500 uppercase tracking-wider">{inv.type}</span>
                                  <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-300">{inv.status}</span>
                                  <span className="ml-2 text-zinc-500">
                                    {fmtMoney(inv.amountPaid)} paid of {fmtMoney(inv.total)}
                                    {inv.balanceDue > 0 && (
                                      <span className="ml-1 text-amber-300"> · {fmtMoney(inv.balanceDue)} due</span>
                                    )}
                                  </span>
                                  {inv.dueDate && inv.status !== 'PAID' && (
                                    <span className="ml-2 text-[10px] text-zinc-500">due {fmtDate(inv.dueDate)}</span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Email threads filed in this Job (email-in-Job, step 6). */}
      <JobEmailThreads jobId={job.id} />

      {/* Notes */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Notes</h2>
          <button
            onClick={saveNotes}
            disabled={!notesDirty || notesSaving}
            className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {notesSaving ? 'Saving…' : notesDirty ? 'Save' : 'Saved'}
          </button>
        </div>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(e.target.value !== (job.notes || ''));
          }}
          rows={6}
          placeholder="Add context, client preferences, deal notes…"
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500 resize-y"
        />
      </div>

      {/* Activity — Phase 7 Pass B. AuditLog feed scoped to this job
          and everything rooted on its orders (invoices, picklists,
          payments). Newest first. Each row formats with who/what/when;
          for UPDATE actions we surface the changed fields' before→after
          when oldValues + newValues both have ≤3 entries (otherwise
          fall back to a generic "updated" line). */}
      {job.activity.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Activity</h2>
            <span className="text-xs text-zinc-500">{job.activity.length} event{job.activity.length === 1 ? '' : 's'}</span>
          </div>
          <ul className="space-y-1.5">
            {job.activity.map((a) => {
              const formatted = formatActivity(a);
              return (
                <li key={a.id} className="flex gap-3 text-xs text-zinc-300 border-l border-zinc-800 pl-3 py-0.5">
                  <span className="text-zinc-500 whitespace-nowrap min-w-[60px]" title={new Date(a.createdAt).toLocaleString()}>
                    {relativeAge(a.createdAt)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-zinc-100">{a.user?.name || 'System'}</span>
                    <span className="text-zinc-400"> {formatted.verb} </span>
                    <span className="text-zinc-100">{formatted.what}</span>
                    {formatted.details && (
                      <span className="text-zinc-500"> · {formatted.details}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Phase 7 Pass B — readable formatter for an AuditLog row. Keeps the
// surface honest: we only synthesize the before→after diff when the
// values are small + scalar. For anything bigger we just say what
// entity moved, and the user clicks through to the entity for detail.
function formatActivity(a: ActivityRow): { verb: string; what: string; details?: string } {
  const action = (a.action || '').toUpperCase();
  const verb =
    action === 'CREATE' || action === 'CREATED'
      ? 'created'
      : action === 'DELETE' || action === 'DELETED'
        ? 'deleted'
        : action === 'STATUS_CHANGE'
          ? 'changed status of'
          : 'updated';
  const what = a.entityType.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Try to render a compact diff for UPDATE actions.
  if ((action === 'UPDATE' || action === 'STATUS_CHANGE') && a.newValues) {
    const newKeys = Object.keys(a.newValues);
    if (newKeys.length > 0 && newKeys.length <= 3) {
      const parts = newKeys.map((k) => {
        const nv = a.newValues?.[k];
        const ov = a.oldValues?.[k];
        const fmt = (v: unknown) => {
          if (v == null) return '∅';
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
          return JSON.stringify(v).slice(0, 40);
        };
        if (ov !== undefined && ov !== nv) {
          return `${k}: ${fmt(ov)} → ${fmt(nv)}`;
        }
        return `${k}: ${fmt(nv)}`;
      });
      return { verb, what, details: parts.join(', ') };
    }
  }

  return { verb, what };
}

function Meta({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-sm text-white mt-0.5 truncate">{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}

// Phase 7 Pass A — at-a-glance rollup chip on the Job header.
// Three tonal modes: good (emerald), warn (amber), idle (zinc).
function RollupChip({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'good' | 'warn' | 'idle';
}) {
  const toneClass =
    tone === 'good'
      ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-200'
      : tone === 'warn'
        ? 'border-amber-900/60 bg-amber-950/30 text-amber-200'
        : 'border-zinc-800 bg-zinc-950 text-zinc-400';
  return (
    <div className={`flex items-baseline gap-1.5 px-2.5 py-1 rounded-md border ${toneClass}`}>
      <span className="text-[9px] uppercase tracking-wider font-semibold opacity-80">{label}</span>
      <span className="text-[12px] font-semibold">{value}</span>
      {sub && <span className="text-[10px] opacity-70">{sub}</span>}
    </div>
  );
}
