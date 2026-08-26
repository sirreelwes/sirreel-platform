'use client';

import { useEffect, useRef, useState } from 'react';
import { isSignedAgreementStatus } from '@/lib/portal/agreementStatus';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { deriveJobDateRange, isoDate } from '@/lib/jobs/dateRange';
import { isStageLineItem } from '@/lib/orders/stageLines';
import { notifyJobsChanged } from '@/components/jobs/JobsListProvider';

/**
 * "Agreement on file" — upload a client's own signed PDF (often an annual
 * master) and link jobs to it, instead of sending each job for signature.
 *
 * HIDDEN (Aug 2026). It had never been used: zero CompanyAgreement rows,
 * zero job links, and zero companies with the parallel annualAgreement*
 * fields set — while the portal signing flow is the one reps actually
 * use. Two unused mechanisms for the same idea, surfaced as a modal that
 * exposes the data model ("Link existing / File new / Type / Annual")
 * rather than a task, was the most confusing thing on this page.
 *
 * Nothing is deleted: the models, the API, the modal component and the
 * chip logic all still work. Flip this to true when a client actually
 * turns up with a standing agreement — and at that point decide whether
 * CompanyAgreement or Company.annualAgreement* is the one to keep,
 * because shipping both is what created the confusion.
 */
const SHOW_AGREEMENT_ON_FILE = false;
import { JobEmailThreads } from '@/components/jobs/JobEmailThreads';
import { JobQuickActions } from '@/components/jobs/JobQuickActions';
import { ProductionTypeProfilePicker } from '@/components/productionTypeProfiles/ProductionTypeProfilePicker';
import { CopyCoiLinkButton } from '@/components/coi/CopyCoiLinkButton';
import { UploadCoiModal } from '@/components/coi/UploadCoiModal';
import { CoiReviewModal } from '@/components/coi/CoiReviewModal';
import { ChangeProductionCompany } from '@/components/jobs/ChangeProductionCompany';
import { evaluateInsuredMatch, INSURED_MATCH_LABEL, INSURED_MATCH_TONE } from '@/lib/coi/insuredMatch';
import { JobDriversSection } from '@/components/jobs/JobDriversSection';
import { JobBookingsSection } from '@/components/jobs/JobBookingsSection';
import { LinkJobAgreementModal } from '@/components/agreements/LinkJobAgreementModal';
import { JobDocumentsPanel } from '@/components/jobs/JobDocumentsPanel';
import { JobRwBillingPanel } from '@/components/jobs/JobRwBillingPanel';
import { JobFinalInvoicePanel } from '@/components/jobs/JobFinalInvoicePanel';
import { formatCadenceLabel, type CadenceRollup, type CadenceState } from '@/lib/jobs/cadence';

/**
 * Job status, honestly split.
 *
 * The header pill is now the DERIVED operational cadence — the same
 * rollup the /jobs board renders (src/lib/jobs/cadence.ts). It follows
 * the orders, so it can't drift the way the old hand-set pill did: this
 * page used to show a green ACTIVE on a job whose only order had no
 * dates, because nothing in the app has ever written ACTIVE — a human
 * picked it from a dropdown once and it stuck.
 *
 * What's left in the dropdown are the three decisions a human actually
 * makes, the ones the orders can't tell us. They override the cadence.
 * "Open" hands the job back to its orders (written as QUOTED, which the
 * rollup ignores the moment a real order exists).
 */
const JOB_STATUSES = ['NEW', 'QUOTED', 'ACTIVE', 'WRAPPED', 'HOLD', 'LOST'] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

const OFF_RAMPS = [
  { value: 'OPEN',    label: 'Open',    hint: 'Position follows the orders' },
  { value: 'HOLD',    label: 'On hold', hint: 'Client paused it — overrides the orders' },
  { value: 'WRAPPED', label: 'Wrapped', hint: 'Closed by hand — overrides the orders' },
  { value: 'LOST',    label: 'Lost',    hint: "Didn't win it — overrides the orders" },
] as const;
type OffRamp = (typeof OFF_RAMPS)[number]['value'];

function currentOffRamp(status: JobStatus): OffRamp {
  return status === 'HOLD' || status === 'WRAPPED' || status === 'LOST' ? status : 'OPEN';
}

const CADENCE_BADGE: Record<CadenceState, string> = {
  new:              'bg-sky-900/40 text-sky-300 border-sky-800',
  quoted:           'bg-purple-900/40 text-purple-300 border-purple-800',
  hold:             'bg-amber-900/40 text-amber-300 border-amber-800',
  lost:             'bg-red-900/40 text-red-300 border-red-800',
  booked:           'bg-teal-900/40 text-teal-300 border-teal-800',
  'picking-tmw':    'bg-teal-900/40 text-teal-300 border-teal-800',
  'picking-today':  'bg-orange-900/40 text-orange-300 border-orange-800',
  'on-rental':      'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  'returning-tmw':  'bg-orange-900/40 text-orange-300 border-orange-800',
  'returning-today':'bg-red-900/40 text-red-300 border-red-800',
  returned:         'bg-purple-900/40 text-purple-300 border-purple-800',
  invoiced:         'bg-blue-900/40 text-blue-300 border-blue-800',
  wrapped:          'bg-zinc-800 text-zinc-300 border-zinc-700',
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


/**
 * Calendar dates (pickup, return, due) — UTC, never local.
 *
 * Separate from fmtDate() on purpose: that one also renders INSTANTS
 * (createdAt, signedAt, …) where local time is correct. Pinning it to UTC
 * would fix the rental dates and break the timestamps. See
 * src/lib/dates/calendarDate.ts.
 */
function fmtDay(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { ...{ month: 'short', day: 'numeric', year: 'numeric' }, timeZone: 'UTC' })
}

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
  inventoryItem: {
    code: string;
    description: string | null;
    slug: string | null;
    trackingMode: string;
  } | null;
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
  rwInvoicedTotal: number;
  rwOrderCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string; notes: string | null };
  agent: { id: string; name: string; email: string };
  jobContacts: JobContact[];
  coiChecks: Array<{ id: string; coverageVerified: boolean; policyExpiryDate: string | null; humanDecision: string; source: string | null; originalFilename: string; aiRiskLevel: string | null; aiRecommendation: string | null; namedInsured: string | null; createdAt: string }>;
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
  /** Derived operational position — same rollup the /jobs board renders. */
  cadence: CadenceRollup;
  // Job-level card-on-file status (derived from the job's bookings'
  // paperwork). Token never leaves the server — display fields only.
  cardAuth: {
    onFile: boolean;
    last4: string | null;
    cardType: string | null;
    cardholderName: string | null;
    paymentPreference: 'CARD' | 'CHECK_WIRE' | null;
  };
  // bookingId → the client's collision-waiver decision, so each reserved
  // asset shows its vehicle's state. UNANSWERED is not DECLINED: one is an
  // open question to chase, the other is a settled answer.
  lcdwByBooking: Record<string, 'ACCEPTED' | 'DECLINED' | 'UNANSWERED'>;
  // Workers' Comp certificates on file across the job's bookings. `id` is
  // the PaperworkRequest id — the download proxy key, not the file URL.
  wcCerts?: Array<{
    id: string; bookingId: string; filename: string; uploadedAt: string | null;
    pass: boolean | null; provider: string | null; insuredName: string | null;
    expiryDate: string | null; expired: boolean | null; issues: string[];
  }>;
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
    catalogItem: { id: string; slug: string | null } | null;
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
  // Which filed certificate is open in the review desk (approve/reject, AI
  // re-run, named-insured mismatch + its fixes).
  const [reviewCoiId, setReviewCoiId] = useState<string | null>(null);
  // Header affordance for re-pointing the job at the right production company.
  const [companyChangeOpen, setCompanyChangeOpen] = useState(false);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  // "Send for signature" — the paperwork portal invite, surfaced here
  // because this is where both contracts' status already lives. The only
  // other entry point is the order page's "Portal access" section, 11
  // sections down and behind a hand-typed email address.
  const [signSendBusy, setSignSendBusy] = useState(false);
  const [signSendMsg, setSignSendMsg] = useState<string>("");
  // Header "More" overflow menu + its actions.
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [ccBusy, setCcBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Inline "Edit job details" panel (name / dates / deal value).
  const [editing, setEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editName, setEditName] = useState('');
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

  // Add-contact form on the Contacts card. Contacts previously attached only
  // through order flows; since the payment-options email routes by them
  // (ACCOUNTING first), a job with a wrong contact set needs fixing in place.
  const [addingContact, setAddingContact] = useState(false);
  const [contactForm, setContactForm] = useState({ email: '', firstName: '', lastName: '', role: 'OTHER' });
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const submitContact = async () => {
    if (contactSaving) return;
    setContactError(null);
    setContactSaving(true);
    try {
      const r = await fetch(`/api/jobs/${id}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contactForm),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setContactError(d.error || 'Could not add contact');
      } else {
        setAddingContact(false);
        setContactForm({ email: '', firstName: '', lastName: '', role: 'OTHER' });
        load();
      }
    } catch {
      setContactError('Network error');
    } finally {
      setContactSaving(false);
    }
  };

  // Every mutation on this page ends in load() — status changes, mark
  // returned, archive, the company swap, the bookings section. So this
  // is the ONE place that tells the jobs list to catch up: re-reading
  // the job after a change means the row beside it is now stale.
  // Skipped on the first read of a job (opening one changed nothing),
  // which is why the ref resets whenever the id does.
  const openedRef = useRef(false);

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
          if (openedRef.current) notifyJobsChanged();
          else openedRef.current = true;
        } else {
          setError(d.error || 'Job not found');
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    openedRef.current = false;
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

  // Hooks MUST sit above the `loading` / `error` early returns below —
  // declaring them after means they do not run on the first render and do on
  // the second, which is "rendered more hooks than during the previous
  // render" and takes the whole page down with a client-side exception.
  const fileSignedRef = useRef<HTMLInputElement | null>(null);
  const [fileSignedBusy, setFileSignedBusy] = useState(false);
  const [fileSignedMsg, setFileSignedMsg] = useState<string | null>(null);

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

  // Deal value: HQ-native order total first; else what RentalWorks has
  // actually invoiced on the linked RW orders; else the manual estimate.
  const dealValue =
    job.orderTotal > 0 ? job.orderTotal
    : job.rwInvoicedTotal > 0 ? job.rwInvoicedTotal
    : job.estimatedValue;
  const dealValueLabel =
    job.orderTotal > 0 ? 'Order Total'
    : job.rwInvoicedTotal > 0 ? 'RW invoiced'
    : job.estimatedValue != null ? 'Estimated' : '—';

  // Phase 7 Pass A — at-a-glance engagement rollup. All derived from
  // the expanded payload; no extra API call.
  const liveOrders = job.orders.filter((o) => o.status !== 'CANCELLED');
  // A job has no dates of its own — see lib/jobs/dateRange. Show the span
  // its ORDERS cover instead of a separately-typed job range that drifts.
  const orderSpan = deriveJobDateRange(job.orders);

  // Operational position. Server-derived (see src/lib/jobs/cadence.ts);
  // the fallback only covers a stale client that fetched before the API
  // started returning it.
  const cadenceState: CadenceState = job.cadence?.state ?? 'quoted';
  const offRamp = currentOffRamp(job.status);

  // Who signs, and therefore who gets the link. PRODUCER first to match
  // buildStageContractProps — the contract names the Producer as the
  // signatory, so the invite has to reach that person and not merely the
  // first contact on the job.
  const signatory =
    job.jobContacts.find((c) => c.role === 'PRODUCER') ??
    job.jobContacts.find((c) => c.isPrimary) ??
    job.jobContacts.find((c) => c.role === 'PM') ??
    job.jobContacts.find((c) => c.role === 'PC') ??
    job.jobContacts[0] ??
    null;

  // The portal link is per-ORDER (portalSlug lives on Order), so pick the
  // order that actually has paperwork waiting; fall back to the first live
  // order when nothing is generated yet.
  // Filing a signed agreement that was executed off-portal (paper, Cognito).
  // Writes SignedAgreement for the order, which is what the CLIENT's portal
  // reads — otherwise they keep being asked to sign something they signed.
  async function onFileSignedPicked(file: File | null) {
    if (!file || !signTargetOrder) return;
    setFileSignedBusy(true);
    setFileSignedMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('contractType', 'RENTAL_AGREEMENT');
      const r = await fetch(`/api/orders/${signTargetOrder.id}/agreement/file-signed`, {
        method: 'POST',
        body: fd,
      });
      const d = await r.json().catch(() => ({}));
      setFileSignedMsg(
        d?.ok
          ? 'Filed — the client\u2019s portal now shows the rental agreement as signed.'
          // Include the status when the server sent no message: a bare
          // "could not file" gives the operator nothing to report or act on.
          : d?.error || `Could not file that agreement (HTTP ${r.status}).`,
      );
    } catch {
      setFileSignedMsg('Could not file that agreement.');
    } finally {
      setFileSignedBusy(false);
      if (fileSignedRef.current) fileSignedRef.current.value = '';
    }
  }

  // Every SignedAgreement across the job's live orders, newest first. The
  // agreement section renders these; without them it described the job's
  // coverage while hiding the actual executed paper.
  const signedOrderAgreements = liveOrders
    .flatMap((o) => o.signedAgreements.map((agreement) => ({ order: o, agreement })))
    .sort((a, b) =>
      (b.agreement.signedAt ?? b.agreement.updatedAt).localeCompare(
        a.agreement.signedAt ?? a.agreement.updatedAt,
      ),
    );

  const signTargetOrder =
    liveOrders.find((o) =>
      // Target an order whose agreement is NOT yet signed — a filed
      // offline agreement counts as signed, so it stops being chased.
      o.signedAgreements.some((a) => !isSignedAgreementStatus(a.status)),
    ) ??
    liveOrders[0] ??
    null;

  // Is anything actually waiting on a signature? The Send button used to
  // shout the same amber CTA at a fully-signed job, right under a header
  // chip reading On file — the page asking for a signature it already had.
  // Re-sending stays possible; it just stops being the headline.
  const signatureOutstanding = signedOrderAgreements.some(
    ({ agreement }) => !isSignedAgreementStatus(agreement.status),
  ) || signedOrderAgreements.length === 0;

  const sendForSignature = async () => {
    if (!signatory || !signTargetOrder) return;
    setSignSendBusy(true);
    setSignSendMsg("");
    try {
      const res = await fetch(`/api/orders/${signTargetOrder.id}/portal-access/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: signatory.person.email,
          firstName: signatory.person.firstName,
          lastName: signatory.person.lastName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSignSendMsg(data.error || `Send failed (HTTP ${res.status})`);
        return;
      }
      // The button says "Send for signature", so send something signable.
      // The invite alone only opens the portal: the rental agreement stays
      // PORTAL_GENERATED, and the client's paperwork row reads "your rep
      // will send the agreement shortly" — which is why an agreement kept
      // failing to go live on the client side (Wes, 2026-08-25). Releasing
      // here makes the action match its label.
      //
      // Tolerated failures: 409 means it is already released or already
      // signed, and either way the client can sign. Anything else is worth
      // saying out loud, but never enough to claim the invite failed.
      let releaseNote = '';
      try {
        const rel = await fetch(`/api/orders/${signTargetOrder.id}/agreement/release`, { method: 'POST' });
        if (!rel.ok && rel.status !== 409) {
          const relData = await rel.json().catch(() => ({}));
          releaseNote = ` — but the agreement could not be released (${relData.error || `HTTP ${rel.status}`}); release it from the order page.`;
        }
      } catch {
        releaseNote = ' — but the agreement release call failed; check it on the order page.';
      }
      // Resend can report a soft failure while the invite itself is fine —
      // surface the URL either way so the rep is never stuck.
      setSignSendMsg(
        data.emailResult?.ok === false
          ? `Invite created but email failed (${data.emailResult?.reason || 'unknown'}). Copy: ${data.portalUrl}`
          : `Sent to ${signatory.person.email} · ${data.portalUrl ?? ''}${releaseNote}`,
      );
      // Pick up the released status so the section stops reading "Pending"
      // while the client can already sign.
      load();
    } catch (err) {
      setSignSendMsg(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSignSendBusy(false);
    }
  };
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
  // Coverage for one contract type, from EITHER route: an on-file
  // company agreement (which wins — often an annual master covering many
  // jobs) or a per-order contract signed through the portal. `source`
  // lets the chip say "On file" rather than "Signed", because the two
  // mean different things to a rep chasing paperwork.
  // Was a local set that did not know about SIGNED_OFFLINE — see
  // isSignedAgreementStatus.
  type CoverageState = 'signed' | 'pending' | 'expired' | 'none';
  const resolveCoverage = (
    addendum?: JobAgreementAddendum,
    agreement?: { status: string },
  ): { state: CoverageState; source: 'onFile' | 'portal' | null } => {
    if (addendum) {
      return { state: isAnnualExpired(addendum) ? 'expired' : 'signed', source: 'onFile' };
    }
    if (agreement && isSignedAgreementStatus(agreement.status)) {
      return { state: 'signed', source: 'portal' };
    }
    if (agreement) return { state: 'pending', source: 'portal' };
    return { state: 'none', source: null };
  };

  // "On file" and "Signed" both mean covered, but a rep chasing paperwork
  // needs to know which — one is a master already in the drawer, the
  // other was countersigned for this job.
  const coverageLabel = (
    c: { state: CoverageState; source: 'onFile' | 'portal' | null },
    rawStatus?: string,
  ): string => {
    if (c.state === 'expired') return 'Expired';
    if (c.state === 'signed') return c.source === 'onFile' ? 'On file' : 'Signed';
    if (c.state === 'pending') return rawStatus?.replace(/_/g, ' ') || 'Pending';
    return 'None';
  };
  const coverageTone = (state: CoverageState): 'good' | 'warn' | 'idle' =>
    state === 'signed' ? 'good' : state === 'expired' || state === 'pending' ? 'warn' : 'idle';

  const rentalCoverage = resolveCoverage(rentalAddendum, rentalAgreement);
  const stageCoverage = resolveCoverage(stageAddendum, stageAgreement);

  // A stage contract is only owed when the job actually books a stage —
  // same department test the order page and canPickupConfirm use.
  const needsStageContract = liveOrders.some((o) => o.lineItems.some(isStageLineItem));
  const stageRelevant = needsStageContract || stageCoverage.state !== 'none';

  // Header chip covers everything this job OWES. Previously it read the
  // rental agreement alone, so a job with an unsigned stage contract
  // still showed "On file" off the back of its rental paperwork.
  const requiredCoverage = [rentalCoverage, ...(stageRelevant ? [stageCoverage] : [])];
  const agreementStatus: CoverageState =
    requiredCoverage.some((c) => c.state === 'expired')
      ? 'expired'
      : requiredCoverage.every((c) => c.state === 'signed')
        ? 'signed'
        : requiredCoverage.some((c) => c.state === 'signed' || c.state === 'pending')
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
// ── Driver display helpers ───────────────────────────────────────────
// One definition, used by both the asset card and the Drivers section, so
// the two can never label the same driver differently.
const driverName = (d: any) =>
  `${d?.driver?.firstName ?? ''} ${d?.driver?.lastName ?? ''}`.trim() || d?.emailSentTo || 'Driver'

/** What a rep needs: can this vehicle actually leave with this person. */
const driverStateLabel = (d: any): string => {
  const dr = d?.driver
  if (!dr) return 'unknown'
  if (dr.licenseExpired) return 'licence expired'
  if (dr.licenseVerified) return 'licence checked'
  if (dr.licenseFrontUrl || dr.licenseBackUrl) return 'licence needs check'
  return d?.firstViewedAt ? 'opened, no licence' : 'invited'
}

const driverTone = (d: any): string => {
  const dr = d?.driver
  if (dr?.licenseExpired) return 'text-rose-300'
  if (dr?.licenseVerified) return 'text-emerald-300'
  if (dr?.licenseFrontUrl || dr?.licenseBackUrl) return 'text-amber-300'
  return 'text-zinc-400'
}

  const reservedAssets = (() => {
    const seen = new Map<string, { assetId: string; unitName: string; category: string; startDate: string; endDate: string; status: string; bookingId: string; bookingAssignmentId: string; drivers: any[] }>()
    for (const b of job.bookings) {
      if (b.status === 'CANCELLED' || b.status === 'ARCHIVED') continue
      for (const it of b.items) {
        for (const a of it.assignments) {
          if (!seen.has(a.asset.id)) {
            seen.set(a.asset.id, {
              assetId: a.asset.id, unitName: a.asset.unitName, category: it.category.name,
              startDate: a.startDate, endDate: a.endDate, status: a.status, bookingId: b.id,
              bookingAssignmentId: a.id,
              drivers: (a as any).driverAssignments ?? [],
            })
          }
        }
      }
    }
    return [...seen.values()].sort((x, y) => x.unitName.localeCompare(y.unitName, undefined, { numeric: true }))
  })()

  // Held categories with no unit picked yet. A driver attaches to a UNIT
  // (BookingAssignment), so these have nothing to name a driver onto — the
  // Drivers card names them rather than silently having no row, which read
  // as "there's no button for this" to whoever was looking.
  const pendingHolds = (() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const out: { bookingItemId: string; category: string; quantity: number; startDate: string | null }[] = []
    for (const b of job.bookings) {
      if (b.status === 'CANCELLED' || b.status === 'ARCHIVED') continue
      // Live dates only — a wrapped job's UNFULFILLED line is history,
      // not something anyone is going to name a driver onto.
      if (b.endDate && new Date(b.endDate) < todayStart) continue
      for (const it of b.items) {
        const live = it.assignments.filter((a) => a.status !== 'SWAPPED')
        if (live.length === 0) {
          out.push({
            bookingItemId: it.id,
            category: it.category.name,
            quantity: it.quantity,
            startDate: b.startDate ?? null,
          })
        }
      }
    }
    return out
  })()

  // Workers' Comp certificates on file (payload is optional — an older
  // cached response or a job with no bookings simply has none).
  const wcCerts = job.wcCerts ?? [];
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
                className={`text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${CADENCE_BADGE[cadenceState]}`}
                title={
                  offRamp === 'OPEN'
                    ? "Derived from this job's orders — same reading as the Jobs board"
                    : `Set by hand to ${offRamp} — this overrides what the orders say`
                }
              >
                {formatCadenceLabel(cadenceState, job.cadence?.partial ?? false)}
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
              {/* Booked under the wrong entity happens — a COI naming someone
                  else is how it usually surfaces. Fixable from here as well as
                  from the COI review desk, since by the time somebody KNOWS
                  the company is wrong they are just as likely to be standing
                  on the job page. */}
              <button
                onClick={() => setCompanyChangeOpen((v) => !v)}
                className="text-[12px] font-semibold text-zinc-500 hover:text-amber-400 transition-colors"
              >
                {companyChangeOpen ? 'Cancel' : 'Change'}
              </button>
            </div>
            {companyChangeOpen && (
              <div className="mt-2.5 max-w-md rounded-xl border border-amber-500/30 bg-amber-500/[0.04] px-3.5 py-3">
                <ChangeProductionCompany
                  jobId={job.id}
                  currentCompanyName={job.company.name}
                  onChanged={load}
                />
              </div>
            )}
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
                  // Derived from the orders — a job carries no dates of
                  // its own (lib/jobs/dateRange). Seeds the hold pickers.
                  startDate: isoDate(orderSpan.start),
                  endDate: isoDate(orderSpan.end),
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
                value={offRamp}
                disabled={statusSaving}
                onChange={(e) => updateStatus(e.target.value === 'OPEN' ? 'QUOTED' : (e.target.value as JobStatus))}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                title={OFF_RAMPS.find((o) => o.value === offRamp)?.hint}
              >
                {OFF_RAMPS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
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
          <Meta
            label="Order span"
            value={
              orderSpan.start || orderSpan.end
                ? `${fmtDate(isoDate(orderSpan.start))} – ${fmtDate(isoDate(orderSpan.end))}`
                : '—'
            }
            sub="from this job's orders"
          />
          <Meta label="Agent" value={job.agent?.name || '—'} />
          <Meta label="Deal Value" value={fmtMoney(dealValue)} sub={dealValueLabel} />
          <Meta
            label="Orders"
            value={String(job.orders.length > 0 ? job.orders.length : job.rwOrderCount)}
            sub={
              job.orders.length > 0
                ? job.rwOrderCount > 0 ? `+${job.rwOrderCount} RW` : undefined
                : job.rwOrderCount > 0 ? 'RentalWorks' : undefined
            }
          />
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
              value={coverageLabel(rentalCoverage, rentalAgreement?.status)}
              tone={coverageTone(rentalCoverage.state)}
            />
            {/* Shows whenever the job books a stage OR a stage agreement
                exists — an on-file stage contract used to be stored and
                then rendered nowhere. */}
            {stageRelevant && (
              <RollupChip
                label="Stage agreement"
                value={coverageLabel(stageCoverage, stageAgreement?.status)}
                tone={coverageTone(stageCoverage.state)}
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
            <div className="mt-1.5 text-[12px] text-zinc-300">{agreementStatus === 'signed'
                ? 'Coverage on file'
                : SHOW_AGREEMENT_ON_FILE
                  ? 'Attach to cover'
                  : 'Send for signature'}</div>
          </a>
          {/* Card Authorization — `id` is the deep-link target for the
              CC Auth chip in the reservation pop-up on /gantt. */}
          <div id="card-auth" className="scroll-mt-4 rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-4">
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

      {/* Reservations — one row per booking, with where it came from.
          Above the unit grid on purpose: two cards for two vans look
          identical whether that is one two-van rental or the same rental
          held twice, and only the booking-level view separates them. */}
      <JobBookingsSection
        bookings={(job.bookings ?? []).map((b: any) => ({
          id: b.id,
          bookingNumber: b.bookingNumber,
          status: b.status,
          startDate: b.startDate,
          endDate: b.endDate,
          planyoCartId: b.planyoCartId ?? null,
          items: (b.items ?? []).map((i: any) => ({
            id: i.id,
            category: i.category ?? null,
            assignments: (i.assignments ?? []).map((a: any) => ({
              id: a.id, status: a.status, asset: a.asset ?? null,
            })),
          })),
        }))}
        onChanged={load}
      />

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
                      // The badge NAMES the decision. It used to be a
                      // two-tone shield that went grey for "declined" and
                      // "never asked" alike, so the answer to "did they take
                      // the waiver?" was unreadable off this page.
                      const lcdw = job.lcdwByBooking?.[a.bookingId] ?? 'UNANSWERED';
                      const style =
                        lcdw === 'ACCEPTED'
                          ? { cls: 'bg-emerald-950/40 text-emerald-300 border-emerald-900', label: 'LCDW', title: 'LCDW accepted — SirReel waives the first $1,000 in collision damage ($24/day/vehicle)' }
                          : lcdw === 'DECLINED'
                            ? { cls: 'bg-zinc-900 text-zinc-400 border-zinc-700', label: 'LCDW declined', title: 'LCDW declined — the client carries their own collision coverage' }
                            : { cls: 'bg-amber-950/40 text-amber-300 border-amber-900/70', label: 'LCDW?', title: 'LCDW not answered yet — the client has not accepted or declined the waiver' };
                      return (
                        <span
                          title={style.title}
                          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${style.cls}`}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2.6 20 6v6c0 4.9-3.4 7.9-8 9.4C7.4 19.9 4 16.9 4 12V6z" />
                            {lcdw === 'ACCEPTED' && <path d="M9 12l2 2 4-4.2" />}
                            {lcdw === 'DECLINED' && <path d="M9.5 9.5l5 5m0-5l-5 5" />}
                          </svg>
                          {style.label}
                        </span>
                      );
                    })()}
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${ASSIGN_BADGE[a.status] ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'}`}>
                      {a.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <div className="mt-0.5 text-[12px] text-zinc-300 truncate">{a.category}</div>
                <div className="mt-1.5 text-[12px] text-zinc-300 font-mono">{fmtDay(a.startDate)} – {fmtDay(a.endDate)}</div>
                {/* Who's driving it — the question a rep asks while looking
                    at the unit, so answered here rather than only in the
                    Drivers section below. */}
                <div className="mt-1.5 text-[11px] truncate">
                  {a.drivers.length === 0 ? (
                    <span className="text-zinc-500">No driver named</span>
                  ) : (
                    <span className={driverTone(a.drivers[0])}>
                      🧑‍✈️ {driverName(a.drivers[0])}
                      {a.drivers.length > 1 && ` +${a.drivers.length - 1}`}
                      {' · '}{driverStateLabel(a.drivers[0])}
                    </span>
                  )}
                </div>
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
      {/* Drivers — who's taking each unit out. Sits directly under the
          reserved assets it describes. */}
      <JobDriversSection
        vehicles={reservedAssets.map((a) => ({
          bookingAssignmentId: a.bookingAssignmentId,
          unitName: a.unitName,
          category: a.category,
          startDate: a.startDate,
          endDate: a.endDate,
          drivers: a.drivers,
        }))}
        pendingHolds={pendingHolds}
        onChanged={load}
      />

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
              // Does the certificate insure the production we papered? Computed
              // on every render against the job's CURRENT company + production
              // name, so correcting a wrong company clears the flag here without
              // re-reviewing the certificate.
              const match = evaluateInsuredMatch(c.namedInsured, [job.company?.name, job.name]);
              return (
                <div key={c.id} className={`rounded-lg border px-3.5 py-2.5 ${match.needsAttention ? 'border-rose-500/40 bg-rose-500/5' : 'border-zinc-800 bg-zinc-950/60'}`}>
                  <div className="flex items-center gap-3">
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
                        {match.verdict !== 'UNKNOWN' && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 ${INSURED_MATCH_TONE[match.verdict]}`}>
                            {INSURED_MATCH_LABEL[match.verdict]}
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-zinc-300">
                        {src} · added {fmtDate(c.createdAt)}
                        {c.policyExpiryDate && <> · expires {fmtDate(c.policyExpiryDate)}</>}
                        {c.namedInsured && <> · insures {c.namedInsured}</>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        onClick={() => setReviewCoiId(c.id)}
                        className="text-[13px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Review
                      </button>
                      <a
                        href={`/api/coi/download/${c.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] font-semibold text-amber-400 hover:text-amber-300"
                      >
                        View PDF →
                      </a>
                    </div>
                  </div>
                  {/* The mismatch is stated in full on the row: a certificate
                      insuring somebody else covers nothing if a unit is
                      damaged, and that is not a detail to hide behind a click. */}
                  {match.needsAttention && (
                    <div className="mt-2 text-[12px] text-rose-200 leading-relaxed">
                      {match.message}{' '}
                      <button
                        onClick={() => setReviewCoiId(c.id)}
                        className="font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-2"
                      >
                        Review &amp; fix
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Workers' Comp — the client's separate WC proof when it isn't
          carried on the main COI (payroll companies issue their own).
          Sits directly under COI: both are insurance documents, and a rep
          chasing coverage reads them together. Empty state is explanatory
          rather than alarming — WC on the main COI is the common case and
          needs no separate upload. */}
      <div id="wc" className="scroll-mt-4 bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
        <div className="flex items-center gap-2.5 mb-2.5">
          <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Workers&rsquo; Compensation</h2>
          {wcCerts.length > 0 && (
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              wcCerts.some((w) => w.pass) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
            }`}>{wcCerts.some((w) => w.pass) ? 'Verified' : 'Needs review'}</span>
          )}
        </div>
        {wcCerts.length === 0 ? (
          <div className="text-[15px] text-zinc-300 border border-dashed border-zinc-800 rounded-xl px-4 py-4 text-center bg-zinc-950/40">
            No separate certificate on file. Workers&rsquo; Comp is usually carried on the
            main COI above — a separate upload is only needed when the client&rsquo;s payroll
            company (EP, Cast &amp; Crew, ADP&hellip;) issues its own.
          </div>
        ) : (
          <div className="space-y-2">
            {wcCerts.map((w) => {
              const tone = w.expired ? 'text-rose-300 bg-rose-500/10'
                : w.pass ? 'text-emerald-300 bg-emerald-500/10'
                : 'text-amber-300 bg-amber-500/10';
              const label = w.expired ? 'Expired' : w.pass ? 'Verified' : 'Needs review';
              return (
                <div key={w.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${tone}`}>{label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] text-white truncate">{w.filename}</div>
                    <div className="text-[12px] text-zinc-300">
                      {w.provider ? `${w.provider}` : 'Client upload'}
                      {w.uploadedAt && <> &middot; added {fmtDate(w.uploadedAt)}</>}
                      {w.expiryDate && <> &middot; expires {w.expiryDate}</>}
                    </div>
                    {w.issues.length > 0 && (
                      <div className="text-[12px] text-amber-300/90 mt-0.5 truncate" title={w.issues.join(' · ')}>
                        {w.issues.join(' · ')}
                      </div>
                    )}
                  </div>
                  <a
                    href={`/api/wc/download/${w.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] font-semibold text-amber-400 hover:text-amber-300 flex-shrink-0"
                  >
                    View PDF &rarr;
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
          <div className="flex items-center gap-2">
            {/* Primary action: the rep's actual next step once a contract
                exists. Names the recipient so nobody has to guess who the
                link reaches, and needs no typing — the signatory is on the
                job already. */}
            <button
              onClick={sendForSignature}
              disabled={signSendBusy || !signatory || !signTargetOrder}
              title={
                !signatory
                  ? 'Add a contact to this job first'
                  : !signTargetOrder
                    ? 'This job has no live order to send paperwork for'
                    : signatureOutstanding
                      ? `Emails the paperwork portal link to ${signatory.person.email}`
                      : `Already signed — re-sends the portal link to ${signatory.person.email}`
              }
              className={`text-[13px] font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                signatureOutstanding
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              }`}
            >
              {signSendBusy
                ? 'Sending…'
                : !signatureOutstanding
                  ? 'Re-send for signature'
                  : signatory
                    ? `Send for signature → ${signatory.person.firstName}`
                    : 'Send for signature'}
            </button>
            {/* Already signed on paper or in Cognito? File it here. This is
                the ONLY action that makes the client's portal stop asking —
                "Link agreement" files the document against the company, which
                the portal does not read. */}
            <input
              ref={fileSignedRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => void onFileSignedPicked(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileSignedRef.current?.click()}
              disabled={fileSignedBusy || !signTargetOrder}
              title={
                !signTargetOrder
                  ? 'This job has no live order to file paperwork against'
                  : 'Upload a signed PDF — marks it signed in the client portal'
              }
              className="text-[13px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-emerald-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {fileSignedBusy ? 'Filing…' : '↑ Upload signed agreement'}
            </button>
            {SHOW_AGREEMENT_ON_FILE && (
              <button
                onClick={() => setAgreementModalOpen(true)}
                className="text-[13px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-amber-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                + Link agreement
              </button>
            )}
          </div>
        </div>
        {fileSignedMsg && (
          <div className="mb-2.5 text-[12px] text-zinc-300 bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2">
            {fileSignedMsg}
          </div>
        )}
        {signSendMsg && (
          <div className="mb-2.5 text-[12px] text-zinc-300 bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2 break-all">
            {signSendMsg}
          </div>
        )}
        {/* "No signed paperwork on this job yet" was measured against
            addenda alone, so a job whose client HAD signed in the portal
            read empty while the header chip two lines up said On file. The
            empty state now has to be empty on both counts. */}
        {job.agreementAddenda.length === 0 && signedOrderAgreements.length === 0 ? (
          <div className="text-[15px] text-zinc-300 border border-dashed border-zinc-800 rounded-xl px-4 py-4 text-center bg-zinc-950/40">
            {SHOW_AGREEMENT_ON_FILE
              ? 'This job isn\u2019t linked to an agreement yet. Attach it to an on-file rental / stage agreement (or file a new one) so it reads covered.'
              : 'No signed paperwork on this job yet. Use Send for signature to have the client countersign in their portal.'}
          </div>
        ) : job.agreementAddenda.length === 0 ? null : (
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
                    {ca.isAnnual && ca.effectiveDate && <> · covers {fmtDay(ca.effectiveDate)}{ca.expiryDate ? ` – ${fmtDay(ca.expiryDate)}` : ''}</>}
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

        {/* Executed order paperwork. The block above is company-level
            standing agreements; a contract the client signed in the portal
            is a different row on a different table, and this section named
            after both of them showed only the first. The paperwork feed
            deep-links here — landing on a section that doesn't mention the
            document you clicked is how "Review" came to mean "you're back
            in the job folder". */}
        {signedOrderAgreements.length > 0 && (
          <div className="mt-3">
            {/* "Order agreements", not "Signed by the client" — the list
                includes rows still waiting on a signature, and each one
                states its own status. */}
            <div className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold mb-1.5">Order agreements</div>
            <div className="space-y-2">
              {signedOrderAgreements.map(({ order, agreement: a }) => {
                const executed = isSignedAgreementStatus(a.status);
                return (
                  <div key={a.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${executed ? 'text-emerald-300 bg-emerald-500/10' : 'text-amber-300 bg-amber-500/10'}`}>
                        {a.status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[15px] text-white font-medium">
                        {a.contractType === 'STAGE_CONTRACT' ? 'Stage contract' : 'Rental agreement'}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-300">{order.orderNumber}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-zinc-300">
                      {a.signedAt ? <>signed {fmtDate(a.signedAt)}</> : 'not signed yet'}
                      {a.signerName && <> · {a.signerName}</>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      {a.signedDocumentUrl ? (
                        <>
                          <a
                            href={`/api/orders/${order.id}/agreement/pdf?type=${a.contractType}&doc=signed`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[13px] font-semibold text-amber-400 hover:text-amber-300"
                          >
                            View signed PDF →
                          </a>
                          <a
                            href={`/api/orders/${order.id}/agreement/pdf?type=${a.contractType}&doc=signed&download=1`}
                            download
                            className="text-[13px] font-semibold text-zinc-300 hover:text-white"
                          >
                            Download
                          </a>
                        </>
                      ) : (
                        <span className="text-[12px] text-zinc-400">No executed PDF filed for this one.</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Contacts — Phase 7 Pass A: surface phone (already fetched,
          previously not rendered) so the agent can reach the client
          after-hours via a single tap. tel: link triggers native
          dialer on mobile / Mac Continuity Calling on desktop. */}
      <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Contacts</h2>
          <button
            onClick={() => { setAddingContact((v) => !v); setContactError(null); }}
            className="text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            {addingContact ? 'Cancel' : '+ Add contact'}
          </button>
        </div>
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
        {addingContact && (
          <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={contactForm.email}
                onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Email *"
                type="email"
                className="col-span-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-600"
              />
              <input
                value={contactForm.firstName}
                onChange={(e) => setContactForm((f) => ({ ...f, firstName: e.target.value }))}
                placeholder="First name"
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-600"
              />
              <input
                value={contactForm.lastName}
                onChange={(e) => setContactForm((f) => ({ ...f, lastName: e.target.value }))}
                placeholder="Last name"
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-600"
              />
            </div>
            <select
              value={contactForm.role}
              onChange={(e) => setContactForm((f) => ({ ...f, role: e.target.value }))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-600"
            >
              <option value="PRODUCER">Producer</option>
              <option value="PM">Production Manager</option>
              <option value="PC">Production Coordinator</option>
              <option value="TRANSPO">Transpo</option>
              <option value="ACCOUNTING">Accounting</option>
              <option value="OTHER">Other</option>
            </select>
            {/* The role is routing, not just a label — say so where it is picked. */}
            <p className="text-[11px] text-zinc-500">
              Accounting receives payment emails (final invoices, payment options).
              Without one, they go to the primary contact.
            </p>
            {contactError && <p className="text-[12px] text-red-400">{contactError}</p>}
            <button
              onClick={submitContact}
              disabled={contactSaving || !contactForm.email.trim()}
              className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              {contactSaving ? 'Adding…' : 'Add contact'}
            </button>
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
                      {fmtDay(order.startDate)} – {fmtDay(order.endDate)}
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
                                {li.pickupDate ? fmtDay(li.pickupDate) : '—'} → {li.returnDate ? fmtDay(li.returnDate) : '—'}
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
                // Post catalog merge both sides carry the merged row's
                // slug; bi.category is the frozen AssetCategory join.
                (b) => b.items.some((bi) => o.lineItems.some((li) =>
                  !!li.inventoryItem?.slug && li.inventoryItem.slug === (bi.catalogItem?.slug ?? bi.category.slug))),
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
                      {fmtDay(o.startDate)} – {fmtDay(o.endDate)}
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
                                        {fmtDay(a.startDate)} → {fmtDay(a.endDate)}
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
                                    <span className="ml-2 text-[11px] text-zinc-300">due {fmtDay(inv.dueDate)}</span>
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
      {/* RW billing: linked RW order → its invoices + balance. Anchored —
          the gantt's order badge / modal deep-link here for RW-linked jobs. */}
      <div id="rw-billing" className="scroll-mt-4">
        <JobRwBillingPanel jobId={job.id} />
      </div>
      {/* Sales -> collections handoff. Sits under RW billing because the
          agent is already looking at the job's RW invoices here. */}
      <JobFinalInvoicePanel jobId={job.id} />

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

      {reviewCoiId && (
        <CoiReviewModal
          coiId={reviewCoiId}
          onClose={() => setReviewCoiId(null)}
          onChanged={load}
        />
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
