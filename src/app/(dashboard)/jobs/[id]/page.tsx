'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { JobEmailThreads } from '@/components/jobs/JobEmailThreads';
import { JobQuickActions } from '@/components/jobs/JobQuickActions';
import { ProductionTypeProfilePicker } from '@/components/productionTypeProfiles/ProductionTypeProfilePicker';
import { CopyCoiLinkButton } from '@/components/coi/CopyCoiLinkButton';
import { UploadCoiModal } from '@/components/coi/UploadCoiModal';
import { LinkJobAgreementModal } from '@/components/agreements/LinkJobAgreementModal';
import { JobDocumentsPanel } from '@/components/jobs/JobDocumentsPanel';

const JOB_STATUSES = ['QUOTED', 'ACTIVE', 'WRAPPED', 'HOLD', 'LOST'] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

const STATUS_BADGE: Record<JobStatus, string> = {
  QUOTED:  'bg-purple-900/40 text-purple-300 border-purple-800',
  ACTIVE:  'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  WRAPPED: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  HOLD:    'bg-amber-900/40 text-amber-300 border-amber-800',
  LOST:    'bg-red-900/40 text-red-300 border-red-800',
};

const ORDER_STATUS_BADGE: Record<string, string> = {
  DRAFT:      'bg-zinc-800 text-zinc-300',
  QUOTE_SENT: 'bg-blue-900/40 text-blue-300',
  CONFIRMED:  'bg-amber-900/40 text-amber-300',
  ACTIVE:     'bg-emerald-900/40 text-emerald-300',
  RETURNED:   'bg-purple-900/40 text-purple-300',
  CLOSED:     'bg-zinc-800 text-zinc-300',
  CANCELLED:  'bg-red-900/40 text-red-300',
};

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Physical-return receipt — a real timestamp, so include the time.
function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
  signedDocumentUrl: string | null;
  updatedAt: string;
}

interface JobAgreementAddendum {
  id: string;
  note: string | null;
  addendumFileUrl: string | null;
  createdAt: string;
  companyAgreement: {
    id: string;
    contractType: string;
    title: string | null;
    isAnnual: boolean;
    effectiveDate: string | null;
    expiryDate: string | null;
    originalFilename: string;
  };
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
  /** 5-digit after-hours access code clients read to the assistant to verify. */
  assistantAuthCode: string | null;
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
  company: { id: string; name: string; notes: string | null };
  agent: { id: string; name: string; email: string };
  jobContacts: JobContact[];
  coiChecks: Array<{ id: string; coverageVerified: boolean; policyExpiryDate: string | null; humanDecision: string; source: string | null; originalFilename: string; aiRiskLevel: string | null; aiRecommendation: string | null; createdAt: string }>;
  agreementAddenda: JobAgreementAddendum[];
  orders: JobOrder[];
  bookings: JobBooking[];
  activity: ActivityRow[];
  fromInquiry: {
    id: string;
    source: 'MANUAL' | 'GMAIL' | 'WEB_FORM';
    createdAt: string;
    title: string;
  } | null;
  // Physical return — semantic "gear is back" marker, set via
  // mark-returned. Separate axis from status (WRAPPED = lifecycle close).
  returnedAt: string | null;
  returnedBy: { id: string; name: string } | null;
  archivedAt: string | null;
  // Job-level card-on-file status (derived from the job's bookings'
  // paperwork). Token never leaves the server — display fields only.
  cardAuth: {
    onFile: boolean;
    last4: string | null;
    cardType: string | null;
    cardholderName: string | null;
    paymentPreference: 'CARD' | 'CHECK_WIRE' | null;
  };
  // bookingId → LCDW accepted, so each reserved asset shows its
  // vehicle's collision-waiver state.
  lcdwByBooking: Record<string, boolean>;
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
  MANUAL:   'bg-zinc-800 text-zinc-300 border-zinc-700',
  GMAIL:    'bg-rose-950/40 text-rose-300 border-rose-900',
  WEB_FORM: 'bg-sky-950/40 text-sky-300 border-sky-900',
};

const ASSIGN_BADGE: Record<string, string> = {
  ASSIGNED:    'bg-sky-950/40 text-sky-300 border-sky-900',
  CHECKED_OUT: 'bg-amber-950/40 text-amber-300 border-amber-900',
  RETURNED:    'bg-emerald-950/40 text-emerald-300 border-emerald-900',
  SWAPPED:     'bg-zinc-800 text-zinc-300 border-zinc-700',
};

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusSaving, setStatusSaving] = useState(false);
  const [returnSaving, setReturnSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [coiModalOpen, setCoiModalOpen] = useState(false);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  // Header "More" overflow menu + its actions.
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [ccBusy, setCcBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Inline "Edit job details" panel (name / dates / deal value).
  const [editing, setEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editValue, setEditValue] = useState('');
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

  // Physical-return toggle — mirrors the board's INTO/OUT-of-RETURNED
  // moves. mark sets returnedAt + who; unmark is the undo.
  const setReturned = async (returned: boolean) => {
    setReturnSaving(true);
    try {
      const res = await fetch(`/api/jobs/${id}/${returned ? 'mark-returned' : 'unmark-returned'}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to update return state');
      }
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update return state');
    } finally {
      setReturnSaving(false);
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

  const flashToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3000);
  };

  const archiveJob = async () => {
    if (!job) return;
    const undo = !!job.archivedAt;
    if (!undo && !window.confirm('Archive this job? It stays reachable but is hidden from the active Jobs list.')) return;
    setArchiving(true);
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/jobs/${id}/archive${undo ? '?undo=1' : ''}`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      flashToast(undo ? 'Job unarchived' : 'Job archived');
      load();
    } catch {
      flashToast('Could not update archive state');
    } finally {
      setArchiving(false);
    }
  };

  // "Send CC request" — mint/copy the client's portal card-authorization
  // link. Copy (not auto-send) so staff paste it wherever they contact
  // the client, mirroring Copy COI link.
  const sendCcRequest = async () => {
    setCcBusy(true);
    try {
      const res = await fetch(`/api/jobs/${id}/cc-request-link`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d.error || 'Failed');
      await navigator.clipboard.writeText(d.url).catch(() => {});
      flashToast('Card-authorization link copied — send it to the client');
    } catch (e) {
      flashToast(e instanceof Error ? e.message : 'Could not create link');
    } finally {
      setCcBusy(false);
    }
  };

  const copyJobLink = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(window.location.href);
      flashToast('Job link copied');
    } catch {
      flashToast('Could not copy link');
    }
  };

  const openEdit = () => {
    if (!job) return;
    setEditName(job.name);
    setEditStart(job.startDate ? job.startDate.slice(0, 10) : '');
    setEditEnd(job.endDate ? job.endDate.slice(0, 10) : '');
    setEditValue(job.estimatedValue != null ? String(job.estimatedValue) : '');
    setEditing(true);
    setMenuOpen(false);
  };

  const saveEdit = async () => {
    if (!job) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim() || job.name,
          startDate: editStart || null,
          endDate: editEnd || null,
          estimatedValue: editValue === '' ? null : Number(editValue),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setEditing(false);
      load();
    } catch (e) {
      flashToast(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setEditSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-zinc-300 text-[15px]">Loading…</div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <div className="text-zinc-300 text-[15px]">{error || 'Job not found'}</div>
        <button
          onClick={() => router.back()}
          className="text-[13px] text-amber-500 hover:text-amber-400"
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
  // Job-level agreement coverage takes precedence: a job attached to an
  // on-file (often annual) master reads "on file" regardless of orders.
  // An expired annual window is surfaced as its own state.
  const now = new Date();
  const rentalAddendum = job.agreementAddenda.find(
    (a) => a.companyAgreement.contractType === 'RENTAL_AGREEMENT',
  );
  const stageAddendum = job.agreementAddenda.find(
    (a) => a.companyAgreement.contractType === 'STAGE_CONTRACT',
  );
  const isAnnualExpired = (a?: JobAgreementAddendum) =>
    !!a?.companyAgreement.isAnnual &&
    !!a.companyAgreement.expiryDate &&
    new Date(a.companyAgreement.expiryDate) < now;
  const agreementStatus =
    rentalAddendum
      ? isAnnualExpired(rentalAddendum)
        ? 'expired'
        : 'signed'
      : rentalAgreement?.status === 'SIGNED_BASELINE' || rentalAgreement?.status === 'SIGNED_NEGOTIATED'
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

  // Unique reserved units across this job's live bookings — for the
  // Reserved Assets section + quick-nav tile. Each links to its reservation
  // on the calendar.
  const reservedAssets = (() => {
    const seen = new Map<string, { assetId: string; unitName: string; category: string; startDate: string; endDate: string; status: string; bookingId: string }>()
    for (const b of job.bookings) {
      if (b.status === 'CANCELLED' || b.status === 'ARCHIVED') continue
      for (const it of b.items) {
        for (const a of it.assignments) {
          if (!seen.has(a.asset.id)) {
            seen.set(a.asset.id, {
              assetId: a.asset.id, unitName: a.asset.unitName, category: it.category.name,
              startDate: a.startDate, endDate: a.endDate, status: a.status, bookingId: b.id,
            })
          }
        }
      }
    }
    return [...seen.values()].sort((x, y) => x.unitName.localeCompare(y.unitName, undefined, { numeric: true }))
  })()

  const coiStatus: 'Verified' | 'Pending' | 'Expired' | 'Missing' = (() => {
    const checks = job.coiChecks ?? [];
    if (checks.length === 0) return 'Missing';
    const latest = checks[0];
    if (latest.coverageVerified) {
      if (latest.policyExpiryDate && new Date(latest.policyExpiryDate) < new Date()) return 'Expired';
      return 'Verified';
    }
    return 'Pending';
  })();

  const primaryContact = job.jobContacts.find((c) => c.isPrimary) ?? job.jobContacts[0] ?? null;
  const extraContacts = Math.max(0, job.jobContacts.length - 1);
  const cardOnFile = job.cardAuth?.onFile;
  const cardSecurityOnly = job.cardAuth?.paymentPreference === 'CHECK_WIRE';
  const pwComplete =
    (coiStatus === 'Verified' ? 1 : 0) +
    (agreementStatus === 'signed' ? 1 : 0) +
    (cardOnFile ? 1 : 0);

  return (
    <div className="max-w-5xl mx-auto space-y-3 text-[15px]">
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-zinc-800 border border-zinc-600 text-white text-[15px] px-4 py-2 rounded-lg shadow-xl">
          {toast}
        </div>
      )}
      <button
        onClick={() => router.back()}
        className="text-[13px] text-zinc-300 hover:text-zinc-300"
      >
        ← Back
      </button>

      {/* Header */}
      <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-mono font-bold tracking-wide text-white bg-zinc-800 border border-zinc-600 rounded px-2.5 py-1">{job.jobCode}</span>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${STATUS_BADGE[job.status]}`}
              >
                {job.status}
              </span>
              {job.returnedAt && (
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider bg-emerald-950/40 text-emerald-300 border-emerald-900"
                  title={`Physically returned ${fmtDateTime(job.returnedAt)}${job.returnedBy ? ` · marked by ${job.returnedBy.name}` : ''}`}
                >
                  Returned
                </span>
              )}
              {job.assistantAuthCode && (
                <span
                  className="inline-flex items-center gap-1.5 text-[14px] font-mono font-bold tracking-[0.15em] text-amber-300 bg-amber-950/40 border border-amber-800/60 rounded px-2.5 py-1"
                  title="Client access code — clients read this to the after-hours assistant to verify their identity"
                >
                  <span className="text-[10px] font-sans font-semibold uppercase tracking-wider text-amber-500/80">Access</span>
                  {job.assistantAuthCode}
                </span>
              )}
            </div>
            <h1
              className="text-3xl font-semibold text-white mt-2 truncate"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: '-0.01em' }}
            >
              {job.name}
            </h1>
            <div className="mt-1 flex items-center gap-2.5 flex-wrap text-[15px] text-zinc-300">
              <span>
                for{' '}
                <Link href={`/crm/${job.company.id}`} className="text-zinc-200 font-medium hover:text-amber-400">
                  {job.company.name}
                </Link>
              </span>
              {(job.startDate || job.endDate) && (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-200 font-mono text-[14px]">
                    {fmtDate(job.startDate)} – {fmtDate(job.endDate)}
                  </span>
                </>
              )}
            </div>
            {primaryContact && (
              <div className="mt-3 inline-flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-800/40 px-3 py-2">
                <span className="w-7 h-7 rounded-full bg-amber-500/10 border border-amber-700/40 flex items-center justify-center text-[12px] font-bold text-amber-300" style={{ fontFamily: "Georgia, serif" }}>
                  {(primaryContact.person.firstName?.[0] ?? '') + (primaryContact.person.lastName?.[0] ?? '')}
                </span>
                <span className="text-[15px] text-white">
                  {primaryContact.person.firstName} {primaryContact.person.lastName}
                </span>
                {primaryContact.isPrimary && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Primary</span>
                )}
                {primaryContact.person.email && (
                  <a href={`mailto:${primaryContact.person.email}`} className="text-[13px] text-zinc-300 hover:text-amber-400 truncate">
                    · {primaryContact.person.email}
                  </a>
                )}
                {extraContacts > 0 && (
                  <span className="text-[12px] text-zinc-300">+{extraContacts} more</span>
                )}
              </div>
            )}
            {/* In-Job creation — the ONLY place quotes/reservations are
                created (canonical-Job consolidation). Job pre-seeded. */}
            <div className="mt-3">
              <JobQuickActions
                job={{
                  id: job.id,
                  jobCode: job.jobCode,
                  name: job.name,
                  company: job.company,
                  startDate: job.startDate,
                  endDate: job.endDate,
                }}
              />
            </div>
            {job.fromInquiry && (
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-zinc-300">
                <span>Originated from</span>
                <Link
                  href={`/inquiries/${job.fromInquiry.id}`}
                  className="text-zinc-300 hover:text-amber-500 underline-offset-2 hover:underline"
                >
                  Inquiry
                </Link>
                <span className="text-zinc-700">·</span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${INQUIRY_SOURCE_BADGE[job.fromInquiry.source]}`}
                >
                  {job.fromInquiry.source.replace('_', ' ')}
                </span>
                <span className="text-zinc-700">·</span>
                <span>captured {relativeAge(job.fromInquiry.createdAt)}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-3 flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/s-logo-white.png" alt="SirReel" className="h-8 w-auto opacity-90 select-none" />
            <div className="flex items-center gap-2">
              <select
                value={job.status}
                disabled={statusSaving}
                onChange={(e) => updateStatus(e.target.value as JobStatus)}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                title="Job status"
              >
                {JOB_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white hover:border-zinc-500 transition-colors"
                >
                  More ▾
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 w-52 z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-1.5">
                      <button
                        onClick={() => { setMenuOpen(false); setReturned(!job.returnedAt); }}
                        disabled={returnSaving}
                        className="w-full text-left text-[14px] text-zinc-200 hover:bg-zinc-800 rounded-lg px-2.5 py-2 disabled:opacity-50"
                      >
                        {job.returnedAt ? 'Unmark returned' : '✓ Mark returned'}
                      </button>
                      <button onClick={openEdit} className="w-full text-left text-[14px] text-zinc-200 hover:bg-zinc-800 rounded-lg px-2.5 py-2">
                        Edit job details
                      </button>
                      <button onClick={copyJobLink} className="w-full text-left text-[14px] text-zinc-200 hover:bg-zinc-800 rounded-lg px-2.5 py-2">
                        Copy job link
                      </button>
                      <div className="h-px bg-zinc-800 my-1" />
                      <button
                        onClick={archiveJob}
                        disabled={archiving}
                        className="w-full text-left text-[14px] text-rose-400 hover:bg-zinc-800 rounded-lg px-2.5 py-2 disabled:opacity-50"
                      >
                        {job.archivedAt ? 'Unarchive job' : 'Archive job'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            {job.returnedAt && (
              <div className="text-[12px] text-emerald-400 font-semibold text-right">
                ✓ Returned {fmtDateTime(job.returnedAt)}
                {job.returnedBy && <span className="text-zinc-300 font-normal"> · {job.returnedBy.name}</span>}
              </div>
            )}
            {job.archivedAt && (
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 bg-rose-950/40 border border-rose-900 rounded px-2 py-0.5">Archived</span>
            )}
          </div>
        </div>

        {/* Inline edit panel (from More ▾ → Edit job details). */}
        {editing && (
          <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-950/60 p-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[11px] uppercase tracking-wider text-zinc-300 font-semibold">Job name</span>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white focus:outline-none focus:border-zinc-500" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-zinc-300 font-semibold">Start</span>
              <input type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white focus:outline-none focus:border-zinc-500" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-zinc-300 font-semibold">End</span>
              <input type="date" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white focus:outline-none focus:border-zinc-500" />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[11px] uppercase tracking-wider text-zinc-300 font-semibold">Estimated deal value ($)</span>
              <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="—" className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white focus:outline-none focus:border-zinc-500" />
            </label>
            <div className="sm:col-span-2 flex items-center gap-2 justify-end">
              <button onClick={() => setEditing(false)} className="text-[13px] text-zinc-300 hover:text-zinc-200 px-3 py-1.5">Cancel</button>
              <button onClick={saveEdit} disabled={editSaving} className="text-[13px] font-semibold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}

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
          <div id="documents" className="scroll-mt-4 mt-4 flex flex-wrap items-center gap-2 text-[12px]">
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
          <div className="text-[11px] uppercase tracking-widest text-zinc-300 font-semibold">
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
          {profileSaving && <span className="text-[11px] text-zinc-300">Saving…</span>}
        </div>
      </div>

      {/* Paperwork status strip — glanceable client-paperwork state.
          COI + Rental Agreement jump to their sections; Card Auth carries
          the "Send CC request" action (client authorizes in their portal). */}
      <div>
        <div className="flex items-center gap-2.5 mb-2 px-0.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-500">Paperwork</span>
          <span className="text-[12px] text-zinc-300">{pwComplete} of 3 complete</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* COI */}
          <a href="#coi" className="group rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 hover:border-amber-600/60 p-4 transition-colors">
            <div className="text-[11px] uppercase tracking-widest text-zinc-300 font-semibold">Certificate of Insurance</div>
            <div className={`mt-2.5 flex items-center gap-2 text-[15px] font-bold ${
              coiStatus === 'Verified' ? 'text-emerald-300' : coiStatus === 'Missing' || coiStatus === 'Expired' ? 'text-rose-300' : 'text-amber-300'
            }`}>
              <span className={`w-2 h-2 rounded-full ${coiStatus === 'Verified' ? 'bg-emerald-400' : coiStatus === 'Missing' || coiStatus === 'Expired' ? 'bg-rose-400' : 'bg-amber-400'}`} />
              {coiStatus}
            </div>
            <div className="mt-1.5 text-[12px] text-zinc-300">{coiStatus === 'Missing' ? 'Action needed' : coiStatus === 'Verified' ? 'On file & verified' : 'Awaiting review'}</div>
          </a>
          {/* Rental Agreement */}
          <a href="#agreement" className="group rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 hover:border-amber-600/60 p-4 transition-colors">
            <div className="text-[11px] uppercase tracking-widest text-zinc-300 font-semibold">Rental Agreement</div>
            <div className={`mt-2.5 flex items-center gap-2 text-[15px] font-bold ${
              agreementStatus === 'signed' ? 'text-emerald-300' : agreementStatus === 'expired' ? 'text-rose-300' : agreementStatus === 'pending' ? 'text-amber-300' : 'text-zinc-300'
            }`}>
              <span className={`w-2 h-2 rounded-full ${agreementStatus === 'signed' ? 'bg-emerald-400' : agreementStatus === 'expired' ? 'bg-rose-400' : agreementStatus === 'pending' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
              {agreementStatus === 'signed' ? 'On file' : agreementStatus === 'pending' ? 'Pending' : agreementStatus === 'expired' ? 'Expired' : 'Not linked'}
            </div>
            <div className="mt-1.5 text-[12px] text-zinc-300">{agreementStatus === 'signed' ? 'Coverage on file' : 'Attach to cover'}</div>
          </a>
          {/* Card Authorization */}
          <div className="rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-4">
            <div className="text-[11px] uppercase tracking-widest text-zinc-300 font-semibold">Card Authorization</div>
            {cardOnFile ? (
              <>
                <div className="mt-2.5 flex items-center gap-2 text-[15px] font-bold text-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  On file{job.cardAuth.last4 ? ` · ····${job.cardAuth.last4}` : ''}
                </div>
                <div className="mt-1.5 text-[12px] text-zinc-300">
                  {cardSecurityOnly ? 'Security only — client pays another way' : job.cardAuth.cardholderName || 'Authorized'}
                </div>
              </>
            ) : (
              <>
                <button
                  onClick={sendCcRequest}
                  disabled={ccBusy}
                  className="mt-2.5 text-[13px] font-semibold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {ccBusy ? 'Preparing…' : '↗ Send CC request'}
                </button>
                <div className="mt-2 text-[12px] text-zinc-300">Client enters it in their portal</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Reserved assets → each opens its reservation on the calendar */}
      <div id="reserved-assets" className="scroll-mt-4 bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Reserved assets</h2>
          <span className="text-[12px] text-zinc-300">{reservedAssets.length} unit{reservedAssets.length === 1 ? '' : 's'}</span>
        </div>
        {reservedAssets.length === 0 ? (
          <div className="mt-3 text-[15px] text-zinc-300">No units reserved on this job yet.</div>
        ) : (
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {reservedAssets.map((a) => (
              <Link
                key={a.assetId}
                href={`/gantt?date=${a.startDate.slice(0, 10)}`}
                title="Open this reservation on the calendar"
                className="group rounded-xl border border-zinc-800 bg-zinc-800/40 hover:border-amber-600/60 hover:bg-zinc-800 p-3 transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <svg className="w-4 h-4 shrink-0 text-amber-500/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2.6 20.5 7v10L12 21.4 3.5 17V7z" />
                      <path d="M3.5 7 12 11.6 20.5 7" />
                      <path d="M12 11.6v9.8" />
                    </svg>
                    <span className="font-semibold text-white group-hover:text-amber-300 transition-colors truncate">{a.unitName}</span>
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(() => {
                      const lcdw = job.lcdwByBooking?.[a.bookingId];
                      return (
                        <span
                          title={lcdw ? 'LCDW accepted — collision damage waiver' : 'LCDW not accepted'}
                          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${lcdw ? 'bg-emerald-950/40 text-emerald-300 border-emerald-900' : 'bg-zinc-800 text-zinc-300 border-zinc-700'}`}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2.6 20 6v6c0 4.9-3.4 7.9-8 9.4C7.4 19.9 4 16.9 4 12V6z" />
                            {lcdw && <path d="M9 12l2 2 4-4.2" />}
                          </svg>
                          LCDW
                        </span>
                      );
                    })()}
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${ASSIGN_BADGE[a.status] ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'}`}>
                      {a.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <div className="mt-0.5 text-[12px] text-zinc-300 truncate">{a.category}</div>
                <div className="mt-1.5 text-[12px] text-zinc-300 font-mono">{fmtDate(a.startDate)} – {fmtDate(a.endDate)}</div>
                <div className="mt-1.5 text-[11px] text-amber-500/70 opacity-0 group-hover:opacity-100 transition-opacity">On calendar →</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Certificate of Insurance — the compliance record. Client-drop
          uploads land here via the portal link; offline COIs (email,
          broker, RentalWorks) are attached with "Upload COI" so HQ stays
          the source of truth without a re-sign. */}
      <div id="coi" className="scroll-mt-4 bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Certificate of Insurance</h2>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              coiStatus === 'Verified' ? 'bg-emerald-500/15 text-emerald-300'
                : coiStatus === 'Pending' ? 'bg-amber-500/15 text-amber-300'
                : 'bg-rose-500/15 text-rose-300'
            }`}>{coiStatus}</span>
          </div>
          <div className="flex items-center gap-3">
            <CopyCoiLinkButton jobId={job.id} variant="dark" />
            <button
              onClick={() => setCoiModalOpen(true)}
              className="text-[13px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-amber-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              + Upload COI
            </button>
          </div>
        </div>
        {job.coiChecks.length === 0 ? (
          <div className="text-[15px] text-zinc-300 border border-dashed border-zinc-800 rounded-xl px-4 py-4 text-center bg-zinc-950/40">
            No certificate on file. Upload one the client sent by email or broker, or use
            <span className="text-zinc-300"> Copy COI link</span> to have them drop it in.
          </div>
        ) : (
          <div className="space-y-2">
            {job.coiChecks.map((c) => {
              const verified = c.coverageVerified || c.humanDecision === 'APPROVED';
              const expired = !!c.policyExpiryDate && new Date(c.policyExpiryDate) < new Date();
              const rowStatus = verified ? (expired ? 'Expired' : 'Verified')
                : c.humanDecision === 'REJECTED' ? 'Rejected' : 'Pending';
              const rowTone = rowStatus === 'Verified' ? 'text-emerald-300 bg-emerald-500/10'
                : rowStatus === 'Pending' ? 'text-amber-300 bg-amber-500/10'
                : 'text-rose-300 bg-rose-500/10';
              const src = c.source === 'CLIENT_UPLOAD' ? 'Client upload'
                : c.source === 'INTERNAL' ? 'Filed by agent' : 'On file';
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${rowTone}`}>{rowStatus}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] text-white truncate">{c.originalFilename}</span>
                      {c.aiRiskLevel && (
                        <span
                          title={`AI review: ${c.aiRecommendation === 'accept' ? 'passes checks' : 'needs review'}`}
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 ${
                            c.aiRiskLevel === 'low' ? 'bg-emerald-500/10 text-emerald-300'
                              : c.aiRiskLevel === 'high' ? 'bg-rose-500/10 text-rose-300'
                              : 'bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          AI · {c.aiRiskLevel} risk
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-zinc-300">
                      {src} · added {fmtDate(c.createdAt)}
                      {c.policyExpiryDate && <> · expires {fmtDate(c.policyExpiryDate)}</>}
                    </div>
                  </div>
                  <a
                    href={`/api/coi/download/${c.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] font-semibold text-amber-400 hover:text-amber-300 flex-shrink-0"
                  >
                    View PDF →
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rental / stage agreement — job-level coverage. A job is attached
          as an addendum to an on-file (often annual) master agreement. */}
      <div id="agreement" className="scroll-mt-4 bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Rental &amp; Stage Agreement</h2>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              agreementStatus === 'signed' ? 'bg-emerald-500/15 text-emerald-300'
                : agreementStatus === 'pending' ? 'bg-amber-500/15 text-amber-300'
                : agreementStatus === 'expired' ? 'bg-rose-500/15 text-rose-300'
                : 'bg-zinc-700/40 text-zinc-300'
            }`}>{agreementStatus === 'signed' ? 'On file' : agreementStatus === 'pending' ? 'Pending' : agreementStatus === 'expired' ? 'Expired' : 'Not linked'}</span>
          </div>
          <button
            onClick={() => setAgreementModalOpen(true)}
            className="text-[13px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-amber-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            + Link agreement
          </button>
        </div>
        {job.agreementAddenda.length === 0 ? (
          <div className="text-[15px] text-zinc-300 border border-dashed border-zinc-800 rounded-xl px-4 py-4 text-center bg-zinc-950/40">
            This job isn&rsquo;t linked to an agreement yet. Attach it to an on-file rental / stage
            agreement (or file a new one) so it reads covered.
          </div>
        ) : (
          <div className="space-y-2">
            {job.agreementAddenda.map((ad) => {
              const ca = ad.companyAgreement;
              const expired = ca.isAnnual && ca.expiryDate && new Date(ca.expiryDate) < new Date();
              return (
                <div key={ad.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${expired ? 'text-rose-300 bg-rose-500/10' : 'text-emerald-300 bg-emerald-500/10'}`}>
                      {expired ? 'Expired' : 'On file'}
                    </span>
                    <span className="text-[15px] text-white font-medium">{ca.title || ca.contractType.replace(/_/g, ' ')}</span>
                    <span className="text-[11px] uppercase tracking-wider text-zinc-300">{ca.contractType.replace(/_/g, ' ')}</span>
                    {ca.isAnnual && (
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 uppercase tracking-wider">Annual</span>
                    )}
                  </div>
                  <div className="mt-1 text-[12px] text-zinc-300">
                    added {fmtDate(ad.createdAt)}
                    {ca.isAnnual && ca.effectiveDate && <> · covers {fmtDate(ca.effectiveDate)}{ca.expiryDate ? ` – ${fmtDate(ca.expiryDate)}` : ''}</>}
                    {ad.note && <> · {ad.note}</>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <a
                      href={`/api/agreements/company/${ca.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] font-semibold text-amber-400 hover:text-amber-300"
                    >
                      View agreement →
                    </a>
                    {ad.addendumFileUrl && (
                      <a
                        href={`/api/agreements/addendum/${ad.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] font-semibold text-amber-400 hover:text-amber-300"
                      >
                        View addendum →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Contacts — Phase 7 Pass A: surface phone (already fetched,
          previously not rendered) so the agent can reach the client
          after-hours via a single tap. tel: link triggers native
          dialer on mobile / Mac Continuity Calling on desktop. */}
      <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
        <h2 className="text-[15px] font-semibold text-white mb-2.5 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Contacts</h2>
        {job.jobContacts.length === 0 ? (
          <div className="text-[15px] text-zinc-300">No contacts yet.</div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {job.jobContacts.map((jc) => (
              <div key={jc.id} className="flex items-center justify-between py-2.5 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-8 h-8 shrink-0 rounded-full bg-amber-500/10 border border-amber-700/40 flex items-center justify-center text-[12px] font-bold text-amber-300"
                    style={{ fontFamily: 'Georgia, serif' }}
                  >
                    {((jc.person.firstName?.[0] ?? '') + (jc.person.lastName?.[0] ?? '')).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                  <div className="text-[15px] text-white truncate">
                    {jc.person.firstName} {jc.person.lastName}
                    {jc.isPrimary && (
                      <span className="ml-2 text-[11px] font-bold text-amber-500 uppercase">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] text-zinc-300 truncate flex items-center gap-3 flex-wrap">
                    {jc.person.email && (
                      <a href={`mailto:${jc.person.email}`} className="hover:text-amber-500">
                        {jc.person.email}
                      </a>
                    )}
                    {jc.person.phone && (
                      <a
                        href={`tel:${jc.person.phone.replace(/[^\d+]/g, '')}`}
                        className="text-zinc-300 hover:text-amber-500 font-mono"
                      >
                        {jc.person.phone}
                      </a>
                    )}
                  </div>
                  </div>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300 bg-zinc-800 px-2 py-1 rounded">
                  {jc.role}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Client notes — READ-ONLY here. Idiosyncrasies & preferences for
          this client, so staff know how they like to work. Authored on
          the client file (Company.notes); this is just the at-a-glance. */}
      <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 transition-colors duration-200 hover:border-zinc-700/70">
        <div className="flex items-start gap-3 flex-wrap">
          <h2 className="text-[13px] font-semibold text-white shrink-0 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-3.5 before:rounded-full before:bg-amber-500/80">
            Client notes
          </h2>
          {job.company.notes?.trim() ? (
            <div className="flex-1 min-w-[240px] text-[14px] text-zinc-200 whitespace-pre-wrap leading-relaxed">
              {job.company.notes}
            </div>
          ) : (
            <div className="flex-1 min-w-[240px] text-[13px] text-zinc-400 italic">
              No preferences or quirks recorded for {job.company.name} yet.
            </div>
          )}
          <Link
            href={`/crm/${job.company.id}`}
            className="shrink-0 text-[12px] font-semibold text-amber-400 hover:text-amber-300"
          >
            Edit on client file →
          </Link>
        </div>
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
          <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Logistics & after-hours</h2>
              <span className="text-[11px] text-zinc-300 uppercase tracking-wider">Free-text from agent notes + stage terms</span>
            </div>
            <div className="space-y-4">
              {rows.map(({ order, dateOverrides, hasNotes, hasStageNotes, hasStageDetail }) => (
                <div key={order.id} className="border-l-2 border-amber-900/40 pl-3">
                  <div className="flex items-center gap-2 mb-1.5 text-[12px]">
                    <Link
                      href={`/orders/${order.id}`}
                      className="font-mono text-zinc-300 hover:text-amber-400"
                    >
                      {order.orderNumber}
                    </Link>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${ORDER_STATUS_BADGE[order.status] || 'bg-zinc-800 text-zinc-300'}`}
                    >
                      {order.status}
                    </span>
                    <span className="text-zinc-300">
                      {fmtDate(order.startDate)} – {fmtDate(order.endDate)}
                    </span>
                  </div>
                  {hasNotes && (
                    <div className="mb-2">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold mb-0.5">Order notes</div>
                      <div className="text-[13px] text-zinc-200 whitespace-pre-wrap leading-relaxed">{order.notes}</div>
                    </div>
                  )}
                  {hasStageDetail && order.stageBookingTerms && (
                    <div className="mb-2">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold mb-0.5">Stage terms</div>
                      <div className="text-[13px] text-zinc-300 flex flex-wrap gap-x-3 gap-y-0.5">
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
                        <div className="mt-1 text-[13px] text-zinc-200 whitespace-pre-wrap leading-relaxed">{order.stageBookingTerms.salesNotes}</div>
                      )}
                    </div>
                  )}
                  {dateOverrides.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold mb-0.5">Off-window pickup / return</div>
                      <ul className="text-[13px] text-zinc-300 space-y-0.5">
                        {dateOverrides.map((li) => (
                          <li key={li.id} className="flex gap-2">
                            <span className="text-zinc-300 min-w-[1rem]">·</span>
                            <span className="flex-1">
                              <span className="text-zinc-100">{li.description}</span>
                              <span className="ml-2 text-zinc-300">
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
      <div id="orders" className="scroll-mt-4 bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Orders</h2>
          <span className="text-[13px] text-zinc-300">{job.orders.length} total · row expands · open for full order</span>
        </div>
        {job.orders.length === 0 ? (
          <div className="text-[15px] text-zinc-300">No orders on this job yet.</div>
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
                    <span className="text-zinc-300 text-[13px] w-3">{expanded ? '▾' : '▸'}</span>
                    <span className="font-mono text-[15px] font-semibold text-white">{o.orderNumber}</span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${ORDER_STATUS_BADGE[o.status] || 'bg-zinc-800 text-zinc-300'}`}
                    >
                      {o.status}
                    </span>
                    {o.addedToJobAt && (
                      <span
                        title="Added later via inquiry triage"
                        className="text-[11px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider bg-zinc-800 text-zinc-300 border border-zinc-700"
                      >
                        Add-on
                      </span>
                    )}
                    <span className="text-[13px] text-zinc-300 whitespace-nowrap">
                      {fmtDate(o.startDate)} – {fmtDate(o.endDate)}
                    </span>
                    <span className="text-[11px] text-zinc-300 ml-2">
                      {o.lineItems.length} line{o.lineItems.length === 1 ? '' : 's'}
                    </span>
                    <span className="ml-auto font-mono text-[13px] text-zinc-200">{fmtMoney(o.total)}</span>
                    <Link
                      href={`/orders/${o.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="ml-2 shrink-0 rounded-md border border-amber-700/50 bg-amber-950/30 px-2.5 py-1 text-[12px] font-bold text-amber-300 hover:bg-amber-900/40 hover:border-amber-600 transition-colors"
                    >
                      Open order →
                    </Link>
                  </button>

                  {expanded && (
                    <div className="border-t border-zinc-800 px-4 py-3 space-y-4">
                      {/* Booked scope */}
                      {o.lineItems.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold mb-1.5">Booked scope</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                              <thead className="text-[10px] uppercase tracking-wider text-zinc-300">
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
                                        <div className="text-[11px] text-zinc-300">{li.qualifier}</div>
                                      )}
                                    </td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{li.quantity}</td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{li.billableDays}</td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{fmtMoney(li.rate)}</td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{fmtMoney(li.lineTotal)}</td>
                                    <td className="py-1.5 pl-2 text-[11px]">
                                      {li.fulfillmentLane && (
                                        <span className="text-zinc-300 uppercase tracking-wider mr-2">{li.fulfillmentLane}</span>
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
                          <div className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold mb-1.5">Per-vehicle assignments</div>
                          <ul className="text-[13px] text-zinc-300 space-y-0.5">
                            {orderBookings.flatMap((b) =>
                              b.items.flatMap((bi) =>
                                bi.assignments.map((a) => (
                                  <li key={a.id} className="flex gap-2">
                                    <span className="text-zinc-300 min-w-[1rem]">·</span>
                                    <span>
                                      <span className="text-zinc-100">{bi.category.name}</span>
                                      <span className="ml-2 font-mono text-amber-300">{a.asset.unitName}</span>
                                      <span className="ml-2 text-zinc-300">
                                        {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
                                      </span>
                                      <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-300">{a.status.replace(/_/g, ' ')}</span>
                                    </span>
                                  </li>
                                )),
                              ),
                            )}
                          </ul>
                        </div>
                      )}

                      {/* Order-native agreements (portal-sign flow). The
                          job's coverage lives in the job-level Agreement
                          section; this is just per-order signing state. */}
                      {o.signedAgreements.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold mb-1.5">Order agreements</div>
                          <ul className="text-[13px] text-zinc-300 space-y-0.5">
                            {o.signedAgreements.map((a) => {
                              const signed = a.status === 'SIGNED_BASELINE' || a.status === 'SIGNED_NEGOTIATED';
                              return (
                                <li key={a.id} className="flex gap-2">
                                  <span className="text-zinc-300 min-w-[1rem]">·</span>
                                  <span className="flex-1">
                                    <span className="text-zinc-100">{a.contractType.replace(/_/g, ' ')}</span>
                                    <span className={`ml-2 text-[11px] uppercase tracking-wider ${signed ? 'text-emerald-300' : 'text-amber-300'}`}>
                                      {a.status.replace(/_/g, ' ')}
                                    </span>
                                    {a.signedAt && (
                                      <span className="ml-2 text-zinc-300">
                                        signed {fmtDate(a.signedAt)}
                                        {a.signerName ? ` · ${a.signerName}` : ''}
                                      </span>
                                    )}
                                    {a.signedDocumentUrl && (
                                      <a
                                        href={`/api/orders/${o.id}/agreement/pdf?type=${a.contractType}&doc=signed`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="ml-2 text-[12px] font-semibold text-amber-400 hover:text-amber-300"
                                      >
                                        View signed PDF →
                                      </a>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Invoices */}
                      {o.invoices.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold mb-1.5">Invoices</div>
                          <ul className="text-[13px] text-zinc-300 space-y-0.5">
                            {o.invoices.map((inv) => (
                              <li key={inv.id} className="flex gap-2">
                                <span className="text-zinc-300 min-w-[1rem]">·</span>
                                <span className="flex-1">
                                  <span className="font-mono text-zinc-100">{inv.invoiceNumber}</span>
                                  <span className="ml-1.5 text-[10px] text-zinc-300 uppercase tracking-wider">{inv.type}</span>
                                  <span className="ml-2 text-[11px] uppercase tracking-wider text-amber-300">{inv.status}</span>
                                  <span className="ml-2 text-zinc-300">
                                    {fmtMoney(inv.amountPaid)} paid of {fmtMoney(inv.total)}
                                    {inv.balanceDue > 0 && (
                                      <span className="ml-1 text-amber-300"> · {fmtMoney(inv.balanceDue)} due</span>
                                    )}
                                  </span>
                                  {inv.dueDate && inv.status !== 'PAID' && (
                                    <span className="ml-2 text-[11px] text-zinc-300">due {fmtDate(inv.dueDate)}</span>
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
      {/* RW quotes/invoices attached to this job (transitional). */}
      <JobDocumentsPanel jobId={job.id} />

      <JobEmailThreads jobId={job.id} />


      {/* Job notes — THIS job only */}
      <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Job notes</h2>
          <button
            onClick={saveNotes}
            disabled={!notesDirty || notesSaving}
            className="px-3 py-1.5 text-[13px] font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
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
          placeholder="Notes for this job only — logistics, deal specifics…"
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white focus:outline-none focus:border-zinc-500 resize-y"
        />
      </div>

      {/* Activity — Phase 7 Pass B. AuditLog feed scoped to this job
          and everything rooted on its orders (invoices, picklists,
          payments). Newest first. Each row formats with who/what/when;
          for UPDATE actions we surface the changed fields' before→after
          when oldValues + newValues both have ≤3 entries (otherwise
          fall back to a generic "updated" line). */}
      {job.activity.length > 0 && (
        <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Activity</h2>
            <span className="text-[13px] text-zinc-300">{job.activity.length} event{job.activity.length === 1 ? '' : 's'}</span>
          </div>
          <ul className="space-y-1.5">
            {job.activity.map((a) => {
              const formatted = formatActivity(a);
              return (
                <li key={a.id} className="flex gap-3 text-[13px] text-zinc-300 border-l border-zinc-800 pl-3 py-0.5">
                  <span className="text-zinc-300 whitespace-nowrap min-w-[60px]" title={new Date(a.createdAt).toLocaleString()}>
                    {relativeAge(a.createdAt)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-zinc-100">{a.user?.name || 'System'}</span>
                    <span className="text-zinc-300"> {formatted.verb} </span>
                    <span className="text-zinc-100">{formatted.what}</span>
                    {formatted.details && (
                      <span className="text-zinc-300"> · {formatted.details}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {coiModalOpen && (
        <UploadCoiModal
          jobId={job.id}
          onClose={() => setCoiModalOpen(false)}
          onUploaded={() => {
            setCoiModalOpen(false);
            load();
          }}
        />
      )}

      {agreementModalOpen && (
        <LinkJobAgreementModal
          jobId={job.id}
          companyName={job.company?.name || 'this company'}
          onClose={() => setAgreementModalOpen(false)}
          onDone={() => {
            setAgreementModalOpen(false);
            load();
          }}
        />
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
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">{label}</div>
      <div className="text-[15px] text-white mt-0.5 truncate">{value}</div>
      {sub && <div className="text-[11px] text-zinc-300">{sub}</div>}
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
        : 'border-zinc-800 bg-zinc-950 text-zinc-300';
  return (
    <div className={`flex items-baseline gap-1.5 px-2.5 py-1 rounded-md border ${toneClass}`}>
      <span className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</span>
      <span className="text-[13px] font-semibold">{value}</span>
      {sub && <span className="text-[11px] opacity-70">{sub}</span>}
    </div>
  );
}
