'use client';

import { useEffect, useRef, useState } from 'react';
import { useMoneyFormatter, useMoneyVisible } from '@/hooks/useMoney';
import { isSignedAgreementStatus } from '@/lib/portal/agreementStatus';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { deriveJobDateRange, deriveOrderWindow, isoDate } from '@/lib/jobs/dateRange';
import { daysUntil, fmtPickup, pickupLabel } from '@/lib/sales/quoteUrgency';
import { isStageLineItem } from '@/lib/orders/stageLines';
import { notifyJobsChanged } from '@/components/jobs/JobsListProvider';

/**
 * "Agreement on file" — upload a client's own signed PDF (often an annual
 * master) and link jobs to it, instead of sending each job for signature.
 *
 * Hidden through Aug 2026: it had never been used (zero CompanyAgreement
 * rows, zero job links), while the portal signing flow was the one reps
 * actually used. Two unused mechanisms for the same idea, surfaced as a
 * modal that exposed the data model rather than a task, was the most
 * confusing thing on this page.
 *
 * VISIBLE AGAIN 2026-09-01 — the condition that comment named ("flip this
 * to true when a client actually turns up with a standing agreement") is
 * now the request: Wes is setting companies up on annual agreements where
 * the client signs once for the year and is asked per job only for the LCDW
 * election. Filing the master is the first step of that setup.
 *
 * The fork it left open is settled: **CompanyAgreement is the one to keep.**
 * Company.annualAgreement* was read by nothing at all, and coverage has to
 * name a DOCUMENT (the job addendum cites it by title) which those loose
 * columns cannot do. Auto-cover therefore hangs off
 * CompanyAgreement.autoCoverJobs — see src/lib/orders/annualCoverage.ts.
 */
const SHOW_AGREEMENT_ON_FILE = true;
import { JobEmailThreads } from '@/components/jobs/JobEmailThreads';
import { JobQuickActions } from '@/components/jobs/JobQuickActions';
import { JobWelcomeButton } from '@/components/jobs/JobWelcomeButton';
import { AddAssetButton } from '@/components/jobs/AddAssetButton';
import { ProductionTypeProfilePicker } from '@/components/productionTypeProfiles/ProductionTypeProfilePicker';
import { CopyCoiLinkButton } from '@/components/coi/CopyCoiLinkButton';
import { UploadCoiModal } from '@/components/coi/UploadCoiModal';
import { CoiReviewModal } from '@/components/coi/CoiReviewModal';
import { ReplacementValueCard, type ReplacementValueData } from '@/components/orders/ReplacementValueCard';
import { MarkLostModal } from '@/components/sales/MarkLostModal';
import { ChangeProductionCompany } from '@/components/jobs/ChangeProductionCompany';
import EnterRedlineModal from '@/components/orders/EnterRedlineModal';
import { isRedlineAwaitingAction } from '@/lib/jobs/redlineAlert';
import { isPlaceholderJobName } from '@/lib/jobs/displayName';
import { TextButton } from '@/components/sms/TextButton';
import { evaluateInsuredMatch, INSURED_MATCH_LABEL, INSURED_MATCH_TONE_LIGHT } from '@/lib/coi/insuredMatch';
import { JobDriversSection } from '@/components/jobs/JobDriversSection';
import { SelfServeEmailButton } from '@/components/jobs/SelfServeEmailButton';
import { JobEmailButton } from '@/components/jobs/JobEmailButton';
import { MarkBookedButton } from '@/components/jobs/MarkBookedButton';
import { AssignUnitsModal } from '@/components/scheduling/AssignUnitsModal';
import { JobBookingsSection } from '@/components/jobs/JobBookingsSection';
import { JobSubRentalsSection } from '@/components/jobs/JobSubRentalsSection';
import { JobAfterHoursPanel } from '@/components/jobs/JobAfterHoursPanel';
import { JobVehiclePickupPanel } from '@/components/jobs/JobVehiclePickupPanel';
import { JobEmailSignalsCard } from '@/components/jobs/JobEmailSignalsCard';
import { LinkJobAgreementModal } from '@/components/agreements/LinkJobAgreementModal';
import { JobLcdwPanel } from '@/components/jobs/JobLcdwPanel';
import { EmailReviewModal, type EmailReviewTarget } from '@/components/email/EmailReviewModal';
import { JobDocumentsPanel } from '@/components/jobs/JobDocumentsPanel';
import { JobConditionPanel } from '@/components/jobs/JobConditionPanel';
import { JobRwBillingPanel } from '@/components/jobs/JobRwBillingPanel';
import { JobFinalInvoicePanel } from '@/components/jobs/JobFinalInvoicePanel';
import { FinalInvoiceTile } from '@/components/jobs/FinalInvoiceTile';
import { JobInvoicesPanel } from '@/components/jobs/JobInvoicesPanel';
import { formatCadenceLabel, type CadenceRollup, type CadenceState } from '@/lib/jobs/cadence';
import { STAGE_HINT, STAGE_LABEL, type JobStage } from '@/lib/jobs/stage';
import { STAGE_CHIP, STAGE_RAIL, readinessMeterStyle } from '@/lib/scheduling/statusTokens';
import { computeReadiness } from '@/lib/jobs/readiness';
import { rollupCoiState } from '@/lib/coi/coiState';
import { AlertTriangle, CalendarDays, Check, User } from 'lucide-react'
import { useSession } from 'next-auth/react';
import { canCreateOrders } from '@/lib/permissions';
import type { UserRole } from '@prisma/client';

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

/**
 * The manual status dropdown is GONE (Wes 2026-09-01: "we need to
 * remove the job status that can be moved manually. It isn't helpful in
 * any way").
 *
 * It offered four positions and none of them earned the click:
 *   · Open / hold — HOLD had ZERO jobs on it in production.
 *   · Wrapped — now a consequence of the client approving the
 *     pre-invoice, not something anyone remembers to toggle.
 *   · Lost — always better served by Mark lost (More ▾), which captures
 *     WHY, expires the follow-up ladder and releases the quote's holds.
 *     The dropdown just flipped a column and did none of that.
 *
 * Where a job is now reads from its orders (lib/jobs/cadence.ts), which
 * is the only answer that cannot go stale. Legacy ACTIVE/HOLD rows are
 * harmless — the rollup ignores the value whenever live orders exist.
 */

const CADENCE_BADGE: Record<CadenceState, string> = {
  new:              'bg-sky-50 text-sky-700 border-sky-200',
  drafted:          'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  quoted:           'bg-purple-50 text-purple-700 border-purple-200',
  hold:             'bg-amber-50 text-amber-700 border-amber-300',
  lost:             'bg-red-50 text-red-700 border-red-200',
  booked:           'bg-teal-50 text-teal-700 border-teal-200',
  'picking-tmw':    'bg-teal-50 text-teal-700 border-teal-200',
  'picking-today':  'bg-orange-50 text-orange-700 border-orange-200',
  'on-rental':      'bg-emerald-50 text-emerald-700 border-emerald-200',
  'returning-tmw':  'bg-orange-50 text-orange-700 border-orange-200',
  'returning-today':'bg-red-50 text-red-700 border-red-200',
  returned:         'bg-purple-50 text-purple-700 border-purple-200',
  invoiced:         'bg-blue-50 text-blue-700 border-blue-200',
  wrapped:          'bg-zinc-100 text-zinc-700 border-zinc-300',
};

const ORDER_STATUS_BADGE: Record<string, string> = {
  DRAFT:      'bg-zinc-100 text-zinc-700',
  QUOTE_SENT: 'bg-blue-50 text-blue-700',
  CONFIRMED:  'bg-amber-50 text-amber-700',
  ACTIVE:     'bg-emerald-50 text-emerald-700',
  RETURNED:   'bg-purple-50 text-purple-700',
  CLOSED:     'bg-zinc-100 text-zinc-700',
  CANCELLED:  'bg-red-50 text-red-700',
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
  /** Set once a redline has been recorded against this agreement. */
  contractReviewId: string | null;
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

/** Order states a verbal/emailed yes can act on. Mirrors BOOKABLE_FROM in
 *  the mark-booked route — DRAFT is excluded on purpose: a client cannot
 *  have approved a quote nobody sent them. */
// DRAFT included 2026-09-10 (Wes): an order the client agreed to off-portal
// can be booked without a quote round. The server skips the booking
// welcome on that path; the button's panel says so.
const MARK_BOOKABLE = new Set(['DRAFT', 'QUOTE_SENT', 'APPROVED']);

/** A "these might be one production" pairing from the Planyo importer.
 *  Derived server-side by lib/jobs/duplicateSignal — never recomputed here. */
interface DuplicateSignal {
  eventId: string;
  detectedAt: string;
  mode: 'created_sibling' | 'attached_ambiguous';
  sentence: string;
  others: { jobId: string; jobCode: string; name: string }[];
}

/**
 * A market is a commercial territory ("Napa Valley"), not a geography, and
 * it comes from the sr_markets table rather than an enum — so this list is
 * fetched, never hardcoded. Nothing filters availability by it yet; market
 * separation still comes from market-scoped categories.
 */
interface MarketOption { id: string; name: string; slug: string }

interface JobDetail {
  id: string;
  jobCode: string;
  /** 5-digit after-hours access code clients read to the assistant to verify. */
  assistantAuthCode: string | null;
  name: string;
  status: JobStatus;
  productionType: string;
  productionTypeProfileId: string | null;
  /** FK to sr_markets; null when nobody has said which market this is. */
  marketId: string | null;
  marketRef: { id: string; name: string; slug: string } | null;
  startDate: string | null;
  endDate: string | null;
  estimatedValue: number | null;
  orderTotal: number;
  rwInvoicedTotal: number;
  rwOrderCount: number;
  notes: string | null;
  driverRequestSentAt?: string | null;
  driverRequestSentTo?: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string; notes: string | null };
  agent: { id: string; name: string; email: string };
  jobContacts: JobContact[];
  coiChecks: Array<{ id: string; coverageVerified: boolean; policyExpiryDate: string | null; humanDecision: string; humanDecisionAt: string | null; source: string | null; originalFilename: string; aiRiskLevel: string | null; aiRecommendation: string | null; namedInsured: string | null; decidedWithVehicles?: boolean | null; createdAt: string;
    /** Carried from the company rather than uploaded here — and whether the
     *  production has confirmed it covers THIS job. Blank word = nothing to
     *  say; this is a chip beside the verdict, never a second verdict. */
    carriedFromCompany?: boolean; confirmationState?: string; confirmationWord?: string;
    /** 'WORKERS_COMP' when the certificate covers workers' comp only — listed,
     *  never the verdict (lib/coi/coverageKind). Absent on carried rows. */
    documentKind?: 'COI' | 'WORKERS_COMP' }>;
  /** Does the job rent a vehicle? Server-computed, and only when a
   *  certificate was signed off gear-only — null otherwise. */
  jobHasVehicles?: boolean | null;
  /** Replacement value of the gear on the job's live orders — the figure the
   *  client's broker writes the equipment limit off. */
  replacementValue?: ReplacementValueData | null;
  /** Set once the production tells us this job runs on its own policy, so
   *  the account certificate stopped standing in for it. */
  coiSeparatePolicy?: { sentence: string; decidedAt: string | null; confirmerName: string | null; note: string | null } | null;
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
  /** Client-supplied logistics, written from the portal's "Deliveries"
   *  section by the production itself. Read-only here — this is their
   *  statement of where a truck reports and when, not our guess. */
  reportToAddress: string | null;
  reportToAccessNotes: string | null;
  reportToTime: string | null;
  reportToContactName: string | null;
  reportToContactPhone: string | null;
  pickupSameAsDelivery: boolean;
  pickupAddress: string | null;
  pickupAccessNotes: string | null;
  pickupTime: string | null;
  reportToUpdatedAt: string | null;
  /** Derived operational position — same rollup the /jobs board renders. */
  cadence: CadenceRollup;
  /** The one color this job wears everywhere — src/lib/jobs/stage.ts. */
  stage?: JobStage;
  // Job-level card-on-file status. TWO stores answer this: the client's
  // portal authorization on the booking's paperwork row, and a card staff
  // keyed in from a signed off-portal CCA, which lives on the COMPANY.
  // Token never leaves the server — display fields only.
  cardAuth: {
    onFile: boolean;
    /** 'job' — authorized in the portal for this job. 'account' — on the
     *  company's wallet, put there for the account rather than this job. */
    origin: 'job' | 'account' | null;
    last4: string | null;
    cardType: string | null;
    cardholderName: string | null;
    paymentPreference: 'CARD' | 'CHECK_WIRE' | 'UNDECIDED' | null;
    /** The $0 stored-credential validation came back approved. */
    validated: boolean;
    /** The card's own MM/YY is already past. */
    expired: boolean;
    /** account cards: where the signed authorization lives, and the label
     *  staff gave the card. */
    authorizationRef: string | null;
    label: string | null;
    /** No-card branch only: when the card link first went out. Once set,
     *  the yard refuses check-out until a card is on file. */
    requestSentAt?: string | null;
    /** Failed portal attempts at this card step, and the latest one. */
    troubleCount: number;
    lastTroubleAt: string | null;
    lastTroubleDetail: string | null;
  };
  // bookingId → the client's collision-waiver decision, so each reserved
  // asset shows its vehicle's state. UNANSWERED is not DECLINED: one is an
  // open question to chase, the other is a settled answer.
  lcdwByBooking: Record<string, 'ACCEPTED' | 'DECLINED' | 'UNANSWERED'>;
  // The JOB-level damage-waiver election — the client's one answer for the
  // whole production, and for an annual account the only paperwork they were
  // asked for. Distinct from lcdwByBooking above, which is the legacy
  // per-booking record from the old portal.
  lcdwElection: {
    decision: 'ACCEPTED' | 'DECLINED';
    decidedAt: string;
    signerName: string | null;
    signerTitle: string | null;
    source: string;
  } | null;
  // Set when the company is on an annual master flagged to auto-cover its
  // jobs. Its presence is why nobody was asked to sign this job.
  annualCoverage: {
    companyAgreementId: string;
    title: string;
    effectiveDate: string | null;
    expiryDate: string | null;
  } | null;
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
    /** REQUESTED / ASSIGNED are live demand; UNFULFILLED is a released
     *  hold and SUBSTITUTED a swapped-out one — both are history. */
    status: 'REQUESTED' | 'ASSIGNED' | 'UNFULFILLED' | 'SUBSTITUTED';
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
  MANUAL:   'bg-zinc-100 text-zinc-700 border-zinc-300',
  GMAIL:    'bg-rose-50 text-rose-700 border-rose-200',
  WEB_FORM: 'bg-sky-50 text-sky-700 border-sky-200',
};

const ASSIGN_BADGE: Record<string, string> = {
  ASSIGNED:    'bg-sky-50 text-sky-700 border-sky-200',
  CHECKED_OUT: 'bg-amber-50 text-amber-700 border-amber-200',
  RETURNED:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  SWAPPED:     'bg-zinc-100 text-zinc-700 border-zinc-300',
};

export default function JobDetailPage() {
  // Wes 2026-09-03: "money value of jobs should not be visible in
  // warehouse/albert/hugo/fleet view." One predicate (seePricing) drives
  // both the redacting formatter — same name the call sites already use
  // — and the money-only blocks below, which are dropped outright rather
  // than left as a row of em-dashes.
  const fmtMoney = useMoneyFormatter({ minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const canSeeMoney = useMoneyVisible();
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [job, setJob] = useState<JobDetail | null>(null);
  // Who may write an order from a reserved unit — same gate as the
  // hero's "+ New quote" (sales + admin; the yard reads, never writes).
  const { data: session } = useSession();
  const canWriteOrders = (() => {
    const u = session?.user as { role?: UserRole; salesOnly?: boolean; email?: string } | undefined;
    return u?.role ? canCreateOrders({ role: u.role, salesOnly: !!u.salesOnly, email: u.email }) : false;
  })();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Replaces the dropdown's "Lost" position with the real flow — it
  // records WHY, expires the follow-up ladder and releases the quote's
  // holds, none of which a status flip did.
  const [markLostOpen, setMarkLostOpen] = useState(false);
  // Release the fleet WITHOUT losing the job — a production dropping one
  // unit is not a lost job (Wes 2026-09-08).
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [returnSaving, setReturnSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [marketSaving, setMarketSaving] = useState(false);
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [coiModalOpen, setCoiModalOpen] = useState(false);
  // "Assign a unit" opens the picker HERE (Wes 2026-09-05, from his phone:
  // "there was never an opportunity to choose the specific truck"). The
  // old path deep-linked to /gantt?assign=, which on a narrow screen
  // renders the Agenda view — and the picker only lived on the timeline
  // board, so a phone never got the list of trucks at all.
  const [assignHoldId, setAssignHoldId] = useState<string | null>(null);
  // Releasing a category hold straight off the job page. Wes 2026-09-10:
  // a duplicate draft quote had already put holds on the job, and
  // deleting the draft left them behind — "drafts assigned units and now
  // they are stuck on the job. Need a way to remove them from the job."
  // The only exits were the Gantt board and cancelling the WHOLE
  // reservation, which takes the good holds down with the stranded ones.
  const [releasingHoldId, setReleasingHoldId] = useState<string | null>(null);
  const [holdReleaseError, setHoldReleaseError] = useState<string | null>(null);
  // Which filed certificate is open in the review desk (approve/reject, AI
  // re-run, named-insured mismatch + its fixes).
  const [reviewCoiId, setReviewCoiId] = useState<string | null>(null);
  // Header affordance for re-pointing the job at the right production company.
  const [companyChangeOpen, setCompanyChangeOpen] = useState(false);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  // Which order's agreement a client redline is being entered against.
  const [redlineOrder, setRedlineOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  // "Send for signature" — the paperwork portal invite, surfaced here
  // because this is where both contracts' status already lives. The only
  // other entry point is the order page's "Portal access" section, 11
  // sections down and behind a hand-typed email address.
  const [signSendBusy, setSignSendBusy] = useState(false);
  const [signSendMsg, setSignSendMsg] = useState<string>("");
  // Wes 2026-09-05: "if there isn't a job name, prompt user to enter it."
  // An unnamed job is fine while it's a placeholder in HQ; it stops being
  // fine the moment we send paperwork, because the name is the headline
  // on the client's portal AND prints on the agreement they sign.
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const [namePromptValue, setNamePromptValue] = useState("");
  const [namePromptBusy, setNamePromptBusy] = useState(false);
  const [namePromptError, setNamePromptError] = useState<string | null>(null);
  // Header "More" overflow menu + its actions.
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [ccBusy, setCcBusy] = useState(false);
  // Card-authorization request — reviewed before it goes out.
  const [emailTarget, setEmailTarget] = useState<EmailReviewTarget | null>(null);
  // Progressive disclosure: empty sections fold into the "Not started"
  // strip; this holds the ones the user expanded by hand this visit.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  // "Upload →" on the Final Invoice tile. Bumping this opens the form on
  // JobFinalInvoicePanel — which also has to be UNFOLDED first: on a job with
  // no HQ order and no RW order the Billing section isn't rendered at all, so
  // the old anchor pointed at an element that didn't exist.
  const [finalInvoiceOpen, setFinalInvoiceOpen] = useState(0);
  const openSection = (k: string, anchor?: string | null) => {
    setOpenSections((prev) => {
      if (prev.has(k)) return prev;
      const next = new Set(prev);
      next.add(k);
      return next;
    });
    if (anchor) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' })),
      );
    }
  };
  // Deep links (#coi, the strip tiles, gantt chips…) must land on a folded
  // section — expand it, then scroll.
  useEffect(() => {
    const HASH_TO_SECTION: Record<string, string> = {
      coi: 'coi', wc: 'wc', agreement: 'agreement', 'reserved-assets': 'assets',
      drivers: 'drivers', orders: 'orders', 'rw-billing': 'money', invoices: 'money',
      'final-invoice': 'money',
      contacts: 'contacts',
    };
    const apply = () => {
      const h = window.location.hash.replace('#', '');
      const k = HASH_TO_SECTION[h];
      if (!k) return;
      setOpenSections((prev) => {
        if (prev.has(k)) return prev;
        const next = new Set(prev);
        next.add(k);
        return next;
      });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => document.getElementById(h)?.scrollIntoView({ block: 'start' })),
      );
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);
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

  // Release ONE held category line. Same route the Gantt board's release
  // uses, so the two cannot drift: the item goes UNFULFILLED and any
  // assignment on it flips to SWAPPED. Nothing is deleted — the row stays
  // readable in the record, it just stops holding the fleet.
  const releaseHold = async (h: { bookingItemId: string; category: string; quantity: number }) => {
    const what = h.quantity > 1 ? `${h.quantity} × ${h.category}` : h.category;
    if (!window.confirm(`Remove the hold on ${what}?\n\nThe capacity is released back to the board. The reservation line stays in the record — this only stops it holding gear for this job.`)) return;
    setReleasingHoldId(h.bookingItemId);
    setHoldReleaseError(null);
    try {
      const res = await fetch(`/api/scheduling/booking-items/${h.bookingItemId}/release`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Could not release it (${res.status})`);
      load();
    } catch (e) {
      setHoldReleaseError(e instanceof Error ? e.message : 'Could not release it');
    } finally {
      setReleasingHoldId(null);
    }
  };

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

  // PATCH the Job's market. Optimistic like saveProfile: the row is one
  // select and a re-fetch of the whole job to change one enum reads as a
  // stall. Reverts on failure so the control never lies about what stuck.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/markets');
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled && Array.isArray(j.markets)) setMarkets(j.markets);
      } catch {
        // A missing market list degrades to "no picker", never a broken page.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveMarket = async (nextId: string) => {
    if (!job || nextId === (job.marketId ?? '')) return;
    const prevId = job.marketId;
    const prevRef = job.marketRef;
    const nextRef = markets.find((m) => m.id === nextId) ?? null;
    setMarketSaving(true);
    setJob({ ...job, marketId: nextId || null, marketRef: nextRef });
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId: nextId || null }),
      });
      if (!res.ok) throw new Error('Failed to save market');
    } catch {
      setJob((j) => (j ? { ...j, marketId: prevId, marketRef: prevRef } : j));
      flashToast('Could not change the market');
    } finally {
      setMarketSaving(false);
    }
  };

  const flashToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3000);
  };

  // Confirmation is INLINE (see the More menu), not window.confirm.
  // The native dialog was taking two or three clicks on OK to take —
  // and a browser dialog on a page that re-renders underneath it is
  // not something we can make reliable from here. A second click on a
  // second control always fires once, and it reads better besides.
  const archiveJob = async () => {
    if (!job) return;
    const undo = !!job.archivedAt;
    setArchiving(true);
    setMenuOpen(false);
    setConfirmArchive(false);
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

  // "Send CC request" — opens the review modal, which previews the real
  // email and only then sends it. It used to mint a portal link, copy it
  // to the clipboard and say "copied", which meant a button labelled Send
  // sent nothing and left no record of whether the client was ever asked
  // (Wes 2026-08-26).
  const sendCcRequest = () => setEmailTarget({ kind: 'card-auth', jobId: id });

  // "Send summary" — the client-facing reading of this very strip: what we
  // have, what we still need, and a button on every outstanding row (Wes
  // 2026-09-09). Goes through the same review modal as every other client
  // send, and the checklist is derived server-side
  // (lib/paperwork/clientPaperworkSummary) rather than from these tiles, so
  // it stays right when the page is stale.
  const sendPaperworkSummary = () =>
    setEmailTarget({ kind: 'paperwork-summary', jobId: id });

  // The link on its own, for staff who'd rather paste it into a text or
  // an existing thread than send our email. Kept from the old button.
  const copyCcLink = async () => {
    setCcBusy(true);
    try {
      const res = await fetch(`/api/jobs/${id}/cc-request-link`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d.error || 'Failed');
      await navigator.clipboard.writeText(d.url);
      flashToast('Card-authorization link copied');
    } catch (e) {
      flashToast(e instanceof Error ? e.message : 'Could not copy link');
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
      <div className="min-h-[60vh] flex items-center justify-center text-zinc-600 text-[15px]">Loading…</div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <div className="text-zinc-600 text-[15px]">{error || 'Job not found'}</div>
        <Link
          href="/jobs"
          className="text-[13px] text-amber-700 hover:text-amber-600"
        >
          ← Back to jobs
        </Link>
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
  // NOT displayed — a job has no dates of its own and HQ no longer shows a
  // job-wide rollup anywhere (Wes 2026-09-01). This survives only to seed
  // default dates on the hold pickers below; the dates a person READS come
  // off the individual orders and bookings.
  const orderSpan = deriveJobDateRange(job.orders);

  // THE PICKUP, in the header (Wes 2026-09-10: "the pickup date at a
  // minimum should be prominently displayed"). This is not the job-wide
  // rollup the 09-01 ruling banned — it is ONE window, named by the order
  // or hold it belongs to, the way the Quotes Out row names its pickup.
  // The one shown is the next to go out; if everything has already gone,
  // the most recent. Other windows are counted, not merged.
  const pickupWindows = (() => {
    const seen = new Set<string>()
    const out: { label: string; start: string; end: string | null }[] = []
    const push = (label: string, start: string | null, end: string | null) => {
      if (!start) return
      const key = `${start.slice(0, 10)}|${(end ?? '').slice(0, 10)}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ label, start: start.slice(0, 10), end: end ? end.slice(0, 10) : null })
    }
    for (const o of liveOrders) {
      const w = deriveOrderWindow({ lineItems: o.lineItems })
      push(o.orderNumber, isoDate(w.start) ?? o.startDate, isoDate(w.end) ?? o.endDate)
    }
    for (const b of job.bookings ?? []) {
      if (b.status === 'CANCELLED' || b.status === 'ARCHIVED') continue
      push(`hold ${b.bookingNumber}`, b.startDate, b.endDate)
    }
    return out
  })();
  const nextPickup = (() => {
    const upcoming = pickupWindows
      .filter((w) => (daysUntil(w.start) ?? -1) >= 0)
      .sort((a, b) => a.start.localeCompare(b.start));
    if (upcoming[0]) return upcoming[0];
    return [...pickupWindows].sort((a, b) => b.start.localeCompare(a.start))[0] ?? null;
  })();
  const pickupDays = nextPickup ? daysUntil(nextPickup.start) : null;
  const pickupTone =
    pickupDays === null ? 'bg-zinc-100 text-zinc-700 border-zinc-200'
    : pickupDays < 0 ? 'bg-zinc-100 text-zinc-700 border-zinc-200'
    : pickupDays <= 2 ? 'bg-rose-50 text-rose-700 border-rose-200'
    : pickupDays <= 6 ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  // Operational position. Server-derived (see src/lib/jobs/cadence.ts);
  // the fallback only covers a stale client that fetched before the API
  // started returning it.
  const cadenceState: CadenceState = job.cadence?.state ?? 'quoted';
  // Stage color (Wes 2026-09-10) — the rail on this header, the chip
  // beside the cadence pill, and the paperwork meter's hue all wear it,
  // matching the /jobs tile and the reservations bar.
  const stage: JobStage = job.stage ?? 'hold';

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

  // The client answered the agreement and we have not answered back. Same
  // predicate the /jobs rail chip uses, so the board and the job cannot
  // disagree about whether someone is waiting on us.
  const redlinedAgreements = signedOrderAgreements.filter(({ agreement: a }) =>
    isRedlineAwaitingAction(a.status),
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

  /**
   * The gate. A job with no real name must not go out for signature —
   * the agreement PDF prints the job name and the client's portal is
   * headlined by it, so "Reservation" or a Planyo cart placeholder would
   * reach the client on paper they are asked to sign. Prompt, save the
   * name (which the PATCH also carries onto the job's bookings, so the
   * client portal headline moves with it), then send.
   */
  const sendForSignature = async () => {
    if (!signatory || !signTargetOrder) return;
    if (job && isPlaceholderJobName(job.name)) {
      setNamePromptValue(job.name ?? "");
      setNamePromptError(null);
      setNamePromptOpen(true);
      return;
    }
    void doSendForSignature();
  };

  const saveNameThenSend = async () => {
    const name = namePromptValue.trim();
    if (name.length < 2) {
      setNamePromptError("Give the show a name — this prints on the agreement.");
      return;
    }
    setNamePromptBusy(true);
    setNamePromptError(null);
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Could not save the name');
      setNamePromptOpen(false);
      await load();
      await doSendForSignature();
    } catch (e) {
      setNamePromptError(e instanceof Error ? e.message : 'Could not save the name');
    } finally {
      setNamePromptBusy(false);
    }
  };

  const doSendForSignature = async () => {
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
    agreement?: { status: string; coveredByAgreementId?: string | null },
  ): { state: CoverageState; source: 'onFile' | 'portal' | null } => {
    if (addendum) {
      return { state: isAnnualExpired(addendum) ? 'expired' : 'signed', source: 'onFile' };
    }
    if (agreement && isSignedAgreementStatus(agreement.status)) {
      return { state: 'signed', source: 'portal' };
    }
    // Covered by a signature on a sibling order of this job — the agreement
    // papers the JOB (lib/orders/agreementCoverage). Same rule the /jobs
    // list applies in rollupAgreementState, so the two can't disagree.
    if (agreement?.coveredByAgreementId) {
      return { state: 'signed', source: 'onFile' };
    }
    if (agreement) return { state: 'pending', source: 'portal' };
    return { state: 'none', source: null };
  };

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
  if (dr?.licenseExpired) return 'text-rose-700'
  if (dr?.licenseVerified) return 'text-emerald-700'
  if (dr?.licenseFrontUrl || dr?.licenseBackUrl) return 'text-amber-700'
  return 'text-zinc-600'
}

  const reservedAssets = (() => {
    const seen = new Map<string, { assetId: string; unitName: string; category: string; startDate: string; endDate: string; status: string; bookingId: string; bookingAssignmentId: string; attachedOrder: { id: string; orderNumber: string } | null; drivers: any[]; currentDriverId: string | null; unitReturned: boolean; driverReturnedAt: string | null; driverReturnMileage: number | null }>()
    for (const b of job.bookings) {
      if (b.status === 'CANCELLED' || b.status === 'ARCHIVED') continue
      for (const it of b.items) {
        for (const a of it.assignments) {
          // SWAPPED is a unit that was taken OFF this job — released, or
          // replaced by another truck. It is terminal-but-auditable, kept
          // so history reads back; it is not a reserved asset. Rendering
          // it here put a released Cube 5 in E.L.F. Project Sooth's
          // "1 unit" count with nothing to do about it (Wes 2026-09-10),
          // and because this map is first-wins per asset it could also
          // shadow the LIVE assignment for the same unit.
          if (a.status === 'SWAPPED') continue
          if (!seen.has(a.asset.id)) {
            seen.set(a.asset.id, {
              assetId: a.asset.id, unitName: a.asset.unitName, category: it.category.name,
              startDate: a.startDate, endDate: a.endDate, status: a.status, bookingId: b.id,
              bookingAssignmentId: a.id,
              // The order this unit goes out ON (BookingAssignment.orderId).
              attachedOrder: (a as any).order ? { id: (a as any).order.id, orderNumber: (a as any).order.orderNumber } : null,
              drivers: (a as any).driverAssignments ?? [],
              currentDriverId: (a as any).checkoutRecords?.[0]?.driverId ?? null,
              unitReturned: !!(a as any).checkoutRecords?.[0]?.returnTime,
              // A driver self return on a blind drop (selfReturn.ts): filed, not yet received.
              driverReturnedAt: (a as any).checkoutRecords?.[0]?.driverReturnedAt ?? null,
              driverReturnMileage: (a as any).checkoutRecords?.[0]?.mileageIn ?? null,
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
    const out: { bookingItemId: string; category: string; quantity: number; startDate: string | null; endDate: string | null }[] = []
    for (const b of job.bookings) {
      if (b.status === 'CANCELLED' || b.status === 'ARCHIVED') continue
      // Live dates only — a wrapped job's UNFULFILLED line is history,
      // not something anyone is going to name a driver onto.
      if (b.endDate && new Date(b.endDate) < todayStart) continue
      for (const it of b.items) {
        // A released hold is not a held one. This used to key ONLY on
        // "has no live assignment", so an item released to UNFULFILLED
        // still rendered "Held · no unit" forever — E.L.F. Project Sooth
        // (SR-JOB-0340) read "1 unit · 4 held" off two live items and two
        // dead ones. SUBSTITUTED is terminal the same way.
        if (it.status === 'UNFULFILLED' || it.status === 'SUBSTITUTED') continue
        const live = it.assignments.filter((a) => a.status !== 'SWAPPED')
        if (live.length === 0) {
          out.push({
            bookingItemId: it.id,
            category: it.category.name,
            quantity: it.quantity,
            startDate: b.startDate ?? null,
            endDate: b.endDate ?? null,
          })
        }
      }
    }
    return out
  })()

  // Workers' Comp certificates on file (payload is optional — an older
  // cached response or a job with no bookings simply has none).
  const wcCerts = job.wcCerts ?? [];
  // SAME rule as the /jobs list (lib/coi/coiState) — this used to call the
  // AI's coverage read "Verified" on its own, while the tile waited for the
  // human APPROVED, so a certificate pending review was green here and
  // "Missing" on the rail (SR-JOB-0311, 2026-09-06). The human decision is
  // the verdict; the AI read is "Pending review" until somebody signs off.
  // The certificate that decides the verdict: the first FULL one. The API
  // sends it first, but a job holding only workers' comp gets none — WC
  // insures the crew, not the rental (MNX / LAFSC, 2026-09-11).
  const governingCoiRow = (job.coiChecks ?? []).find((c) => c.documentKind !== 'WORKERS_COMP') ?? null;
  const coiStatus: 'Verified' | 'Pending' | 'Expired' | 'Rejected' | 'Missing' = (() => {
    if (!governingCoiRow) return 'Missing';
    const latest = governingCoiRow;
    const { state } = rollupCoiState({
      humanDecision: latest.humanDecision,
      policyExpiryDate: latest.policyExpiryDate,
      coverageVerified: !!latest.coverageVerified,
      // A sign-off made when the job rented no vehicle does not cover the one
      // added afterwards — it reads Rejected here, not Verified.
      decidedWithVehicles: latest.decidedWithVehicles ?? null,
      jobHasVehicles: job.jobHasVehicles ?? null,
    });
    return state === 'VERIFIED' ? 'Verified' : state === 'EXPIRED' ? 'Expired' : state === 'ISSUE' ? 'Rejected' : 'Pending';
  })();
  // Why it is pending, in one line — an AI pass awaiting a person is a very
  // different chase from a certificate nobody has looked at.
  const coiPendingWhy =
    coiStatus === 'Pending' && governingCoiRow?.coverageVerified
      ? 'Coverage reads OK — awaiting HQ approval'
      : 'Awaiting review';

  const primaryContact = job.jobContacts.find((c) => c.isPrimary) ?? job.jobContacts[0] ?? null;
  const extraContacts = Math.max(0, job.jobContacts.length - 1);
  const cardOnFile = job.cardAuth?.onFile;
  const cardSecurityOnly = job.cardAuth?.paymentPreference === 'CHECK_WIRE';
  // Distinct from security-only: the client authorized the card but has not
  // said how they'll pay. Do not read that as consent to the processing fee.
  const cardPrefUndecided = job.cardAuth?.paymentPreference === 'UNDECIDED';
  // Keyed from a signed authorization onto the company's wallet, not typed by
  // this client in the portal.
  const cardFromAccount = job.cardAuth?.origin === 'account';
  // Amber, not green: the gateway refused the $0 check, or the card's own
  // expiry has passed. Either way someone should ask before the truck rolls.
  const cardWarn = !job.cardAuth?.validated || !!job.cardAuth?.expired;
  // Five-check readiness — SAME helper the /jobs sidebar chip uses
  // (src/lib/jobs/readiness.ts), so the strip and the list agree. The
  // page's own richer statuses are mapped down to the helper's pass/fail
  // inputs: agreementStatus already folds stage into 'signed', so stage
  // travels as null here.
  const liveB = (job.bookings ?? []).filter((b: any) => b.status !== 'CANCELLED');
  const liveHoldItems = liveB.flatMap((b: any) =>
    (b.items ?? []).filter((i: any) => i.status === 'REQUESTED' || i.status === 'ASSIGNED'),
  );
  const activeAssignments = liveHoldItems.flatMap((i: any) =>
    (i.assignments ?? []).filter((a: any) => a.status === 'ASSIGNED' || a.status === 'CHECKED_OUT'),
  );
  const readiness = computeReadiness({
    coi: coiStatus === 'Verified' ? 'VERIFIED' : coiStatus === 'Expired' ? 'EXPIRED' : coiStatus === 'Rejected' ? 'ISSUE' : coiStatus === 'Pending' ? 'PENDING' : 'NONE',
    rental: agreementStatus === 'signed' ? 'SIGNED' : agreementStatus === 'pending' ? 'SENT' : 'NONE',
    stage: null,
    cardOnFile: !!cardOnFile,
    cardRequested: !!job.cardAuth?.requestSentAt,
    gear: {
      total: liveHoldItems.length,
      assigned: liveHoldItems.filter((i: any) => i.status === 'ASSIGNED').length,
    },
    drivers: {
      units: activeAssignments.length,
      named: activeAssignments.filter((a: any) => (a.driverAssignments ?? []).length > 0).length,
    },
  });
  const gearBlocked = readiness.blockers.some((b) => b.key === 'gear');
  const driverBlocked = readiness.blockers.some((b) => b.key === 'driver');

  // ── The page grows with the job (Wes 2026-08-27, from the approved
  // mockup). Scoring on the Paperwork strip starts when the job has
  // commercial substance — a live reservation or a non-cancelled order.
  // Before that, "no COI" is a normal new job, not a deficiency, and the
  // strip reads a neutral "Not yet" with next-step hints instead of a
  // score. Same outbound-band idea the sidebar chip uses.
  const stripScored = liveB.length > 0 || liveOrders.length > 0;

  // Which sections have anything to show. An empty section folds into the
  // "Not started" strip near the bottom and expands in place on click (or
  // renders automatically the moment it gains content — these predicates
  // re-run on every load()). Logistics is absent on purpose: it derives
  // from orders and already hides itself when it has nothing to say.
  const sectionEmpty: Record<string, boolean> = {
    coi: !governingCoiRow,
    wc: wcCerts.length === 0,
    agreement: agreementStatus === 'none',
    reservations: (job.bookings ?? []).length === 0,
    // A held category with no unit picked lives in the assets card too —
    // hiding the card on "no units" hid the one control that assigns one
    // (Wes 2026-09-05: "I don't see where to choose hold no unit").
    assets: reservedAssets.length === 0 && pendingHolds.length === 0,
    drivers: reservedAssets.length === 0 && pendingHolds.length === 0,
    orders: job.orders.length === 0,
    money: job.orders.length === 0 && job.rwOrderCount === 0,
    contacts: job.jobContacts.length === 0,
    clientNotes: !job.company?.notes?.trim(),
  };
  const showSec = (k: keyof typeof sectionEmpty) => !sectionEmpty[k] || openSections.has(k);
  // Chips only for sections that OFFER something when opened empty —
  // an upload, a send, a link, an explanation. Reservations / assets /
  // drivers / orders are absent on purpose: their empty states are inert
  // (JobBookingsSection renders null outright) and their create actions
  // are the hero's "+ New quote" / "+ New reservation"; they appear here
  // automatically the moment they have content. Email threads likewise
  // self-hides and has no in-section way to start one.
  const FOLD_META: Array<{ key: string; label: string; anchor: string | null }> = [
    { key: 'coi', label: 'Certificate of Insurance', anchor: 'coi' },
    { key: 'wc', label: "Workers' Comp", anchor: 'wc' },
    { key: 'agreement', label: 'Agreement', anchor: 'agreement' },
    // Anchors at the HQ invoice, not the RW block below it — the invoice is
    // what someone opening "Billing" is looking for.
    // Billing & documents is money end to end — the invoice, the RW
    // balance, the final-invoice handoff. Hidden entirely, chip and all,
    // for viewers without seePricing (the yard crew).
    ...(canSeeMoney
      ? [{ key: 'money', label: 'Billing & documents', anchor: 'invoices' }]
      : []),
    { key: 'contacts', label: 'Contacts', anchor: 'contacts' },
    { key: 'clientNotes', label: 'Client notes', anchor: null },
  ];
  const foldedChips = FOLD_META.filter((m) => sectionEmpty[m.key] && !openSections.has(m.key));

  return (
    <div className="max-w-5xl mx-auto space-y-3 text-[15px]">
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-zinc-100 border border-zinc-300 text-zinc-900 text-[15px] px-4 py-2 rounded-lg shadow-xl">
          {toast}
        </div>
      )}
      {/* Deliberately a link to the list, NOT router.back(). The rail
          pushes a history entry per job, so history-back landed on
          whichever job you happened to look at before this one — Wes
          read that as the page "defaulting to a random job". Back means
          the top of the jobs page, every time. */}
      <Link
        href="/jobs"
        className="text-[13px] text-zinc-600 hover:text-zinc-900 transition-colors"
      >
        ← Back to jobs
      </Link>

      {/* Header */}
      <div className="relative overflow-hidden bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 pl-5 transition-colors duration-200 hover:border-zinc-400">
        {/* Stage rail — the same strip the /jobs tile carries. */}
        <span
          className={`absolute left-0 top-0 bottom-0 w-1.5 ${STAGE_RAIL[stage]}`}
          title={`${STAGE_LABEL[stage]} — ${STAGE_HINT[stage]}`}
          aria-hidden="true"
        />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-mono font-bold tracking-wide text-zinc-900 bg-zinc-100 border border-zinc-300 rounded px-2.5 py-1">{job.jobCode}</span>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${STAGE_CHIP[stage]}`}
                title={STAGE_HINT[stage]}
              >
                {STAGE_LABEL[stage]}
              </span>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${CADENCE_BADGE[cadenceState]}`}
                title={
                  job.status === 'LOST' || job.status === 'WRAPPED'
                    ? `Job is ${job.status.toLowerCase()} — that overrides what the orders say`
                    : "Derived from this job's orders — same reading as the Jobs board"
                }
              >
                {formatCadenceLabel(cadenceState, job.cadence?.partial ?? false)}
              </span>
              {job.returnedAt && (
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider bg-emerald-50 text-emerald-700 border-emerald-200"
                  title={`Physically returned ${fmtDateTime(job.returnedAt)}${job.returnedBy ? ` · marked by ${job.returnedBy.name}` : ''}`}
                >
                  Returned
                </span>
              )}
              {/* Solid, not outlined, and a link rather than a label: a
                  redline is a client waiting on an answer, and the answer is
                  four sections down the page. */}
              {redlinedAgreements.length > 0 && (
                <a
                  href="#agreement"
                  title={`Client redlined ${redlinedAgreements
                    .map(({ order }) => order.orderNumber)
                    .join(', ')} — nobody has answered yet`}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-rose-600 text-white hover:bg-rose-500 transition-colors"
                >
                  <AlertTriangle size={12} aria-hidden />
                  Redline back
                  {redlinedAgreements.length > 1 ? ` ×${redlinedAgreements.length}` : ''}
                </a>
              )}
              {job.assistantAuthCode && (
                <span
                  className="inline-flex items-center gap-1.5 text-[14px] font-mono font-bold tracking-[0.15em] text-amber-700 bg-amber-50 border border-amber-300 rounded px-2.5 py-1"
                  title="Client access code — clients read this to the after-hours assistant to verify their identity"
                >
                  <span className="text-[10px] font-sans font-semibold uppercase tracking-wider text-amber-700">Access</span>
                  {job.assistantAuthCode}
                </span>
              )}
              {/* The client set this job up on the public site and nobody
                  has quoted it. Says so, and offers the next-steps email —
                  reviewed before it sends (Wes 2026-09-08). */}
              {(job as { selfServeUnquoted?: boolean }).selfServeUnquoted && (
                <>
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider bg-violet-50 text-violet-700 border-violet-200"
                    title="Created by the client on the public rental-agreement page — no quote has gone out"
                  >
                    Client-created
                  </span>
                  <SelfServeEmailButton jobId={id} />
                </>
              )}
            </div>
            <h1
              className="font-display text-[30px] leading-tight text-zinc-900 mt-2 truncate"
              style={{ letterSpacing: '-0.02em' }}
            >
              {job.name}
            </h1>
            <div className="mt-1 flex items-center gap-2.5 flex-wrap text-[15px] text-zinc-700">
              <span>
                for{' '}
                <Link href={`/crm/${job.company.id}`} className="text-zinc-800 font-medium hover:text-amber-600">
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
                className="text-[12px] font-semibold text-zinc-600 hover:text-amber-600 transition-colors"
              >
                {companyChangeOpen ? 'Cancel' : 'Change'}
              </button>
            </div>
            {companyChangeOpen && (
              <div className="mt-2.5 max-w-md rounded-xl border border-amber-300 bg-amber-500/[0.04] px-3.5 py-3">
                <ChangeProductionCompany
                  jobId={job.id}
                  currentCompanyName={job.company.name}
                  onChanged={load}
                />
              </div>
            )}
            {nextPickup && (
              <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <CalendarDays className="w-5 h-5 text-amber-700 flex-shrink-0" aria-hidden />
                <span className="text-[19px] font-semibold text-zinc-900 leading-tight">
                  {pickupDays !== null && pickupDays < 0 ? 'Picked up' : 'Picks up'} {fmtPickup(nextPickup.start)}
                </span>
                {/* Phone: the return takes its own line, no separator to
                    orphan. Wider: one line, dot between. */}
                {nextPickup.end && (
                  <span className="text-[15px] text-zinc-700 w-full sm:w-auto">
                    <span className="hidden sm:inline">· </span>back {fmtPickup(nextPickup.end)}
                  </span>
                )}
                {!job.returnedAt && (
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${pickupTone}`}>
                    {pickupLabel(nextPickup.start)}
                  </span>
                )}
                <span className="text-[12px] text-zinc-600">
                  {nextPickup.label}
                  {pickupWindows.length > 1 && (
                    <>
                      {' '}· <a href="#orders" className="hover:text-amber-600 underline-offset-2 hover:underline">
                        +{pickupWindows.length - 1} more window{pickupWindows.length - 1 === 1 ? '' : 's'}
                      </a>
                    </>
                  )}
                </span>
              </div>
            )}
            {/* Who we'd be writing to, and the button that writes to them.
                The button is NOT inside the `primaryContact &&` guard —
                a job with no contact on file is exactly the one whose
                client is only reachable through the email thread, which
                is where the composer gets its address from. */}
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {primaryContact && (
              <div className="inline-flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="w-7 h-7 rounded-full bg-amber-50 border border-amber-300 flex items-center justify-center text-[12px] font-bold text-amber-700" style={{ fontFamily: "Georgia, serif" }}>
                  {(primaryContact.person.firstName?.[0] ?? '') + (primaryContact.person.lastName?.[0] ?? '')}
                </span>
                <span className="text-[15px] text-zinc-900">
                  {primaryContact.person.firstName} {primaryContact.person.lastName}
                </span>
                {primaryContact.isPrimary && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Primary</span>
                )}
                {primaryContact.person.email && (
                  <a href={`mailto:${primaryContact.person.email}`} className="text-[13px] text-zinc-700 hover:text-amber-600 truncate">
                    · {primaryContact.person.email}
                  </a>
                )}
                {extraContacts > 0 && (
                  <a href="#contacts" className="text-[12px] text-zinc-600 hover:text-amber-600">
                    +{extraContacts} more
                  </a>
                )}
              </div>
            )}
              <JobEmailButton jobId={job.id} />
            </div>
            {/* In-Job creation — the ONLY place quotes/reservations are
                created (canonical-Job consolidation). Job pre-seeded. */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
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
              {/* The client's welcome — hello + their no-login link to
                  this job (Wes 2026-09-11). Loud while a quote is out and
                  nothing has welcomed them; quiet once sent. */}
              <JobWelcomeButton jobId={job.id} onSent={load} />
            </div>
            {job.fromInquiry && (
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-zinc-700">
                <span>Originated from</span>
                <Link
                  href={`/inquiries/${job.fromInquiry.id}`}
                  className="text-zinc-700 hover:text-amber-600 underline-offset-2 hover:underline"
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
              <div className="relative">
                <button
                  onClick={() => { setConfirmArchive(false); setMenuOpen((o) => !o); }}
                  className="px-3 py-1.5 bg-zinc-100 border border-zinc-300 rounded-lg text-[15px] text-zinc-900 hover:border-zinc-400 transition-colors"
                >
                  More ▾
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => { setConfirmArchive(false); setMenuOpen(false); }} />
                    <div className="absolute right-0 top-full mt-1.5 w-52 z-20 bg-white border border-zinc-300 rounded-xl shadow-xl p-1.5">
                      <button
                        onClick={() => { setMenuOpen(false); setReturned(!job.returnedAt); }}
                        disabled={returnSaving}
                        className="w-full text-left text-[14px] text-zinc-800 hover:bg-zinc-100 rounded-lg px-2.5 py-2 disabled:opacity-50"
                      >
                        {job.returnedAt ? 'Unmark returned' : 'Mark returned'}
                      </button>
                      <button onClick={openEdit} className="w-full text-left text-[14px] text-zinc-800 hover:bg-zinc-100 rounded-lg px-2.5 py-2">
                        Edit job details
                      </button>
                      <button
                        onClick={() => { setMenuOpen(false); setReleaseOpen(true); }}
                        className="w-full text-left text-[14px] text-rose-700 hover:bg-zinc-100 rounded-lg px-2.5 py-2"
                      >
                        Release holds…
                      </button>
                      {job.status !== 'LOST' && (
                        <button
                          onClick={() => { setMenuOpen(false); setMarkLostOpen(true); }}
                          className="w-full text-left text-[14px] text-rose-700 hover:bg-zinc-100 rounded-lg px-2.5 py-2"
                        >
                          Mark job lost…
                        </button>
                      )}
                      <button onClick={copyJobLink} className="w-full text-left text-[14px] text-zinc-800 hover:bg-zinc-100 rounded-lg px-2.5 py-2">
                        Copy job link
                      </button>
                      <div className="h-px bg-zinc-100 my-1" />
                      {job.archivedAt ? (
                        <button
                          onClick={archiveJob}
                          disabled={archiving}
                          className="w-full text-left text-[14px] text-rose-600 hover:bg-zinc-100 rounded-lg px-2.5 py-2 disabled:opacity-50"
                        >
                          Unarchive job
                        </button>
                      ) : confirmArchive ? (
                        <>
                          <button
                            onClick={archiveJob}
                            disabled={archiving}
                            className="w-full text-left text-[14px] font-semibold text-white bg-rose-700 hover:bg-rose-600 rounded-lg px-2.5 py-2 disabled:opacity-50"
                          >
                            {archiving ? 'Archiving…' : 'Yes, archive this job'}
                          </button>
                          <p className="px-2.5 py-1.5 text-[11px] leading-snug text-zinc-600">
                            It drops out of the Jobs list. Still reachable under the list&rsquo;s
                            Archived filter, and you can unarchive it from here.
                          </p>
                          <button
                            onClick={() => setConfirmArchive(false)}
                            className="w-full text-left text-[13px] text-zinc-600 hover:bg-zinc-100 rounded-lg px-2.5 py-1.5"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmArchive(true)}
                          disabled={archiving}
                          className="w-full text-left text-[14px] text-rose-600 hover:bg-zinc-100 rounded-lg px-2.5 py-2 disabled:opacity-50"
                        >
                          Archive job
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            {job.returnedAt && (
              <div className="text-[12px] text-emerald-700 font-semibold text-right">
                Returned {fmtDateTime(job.returnedAt)}
                {job.returnedBy && <span className="text-zinc-700 font-normal"> · {job.returnedBy.name}</span>}
              </div>
            )}
            {job.archivedAt && (
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-0.5">Archived</span>
            )}
          </div>
        </div>

        {/* Inline edit panel (from More ▾ → Edit job details). */}
        {editing && (
          <div className="mt-4 rounded-xl border border-zinc-300 bg-zinc-50 p-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[11px] uppercase tracking-wider text-zinc-700 font-semibold">Job name</span>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className="px-3 py-1.5 bg-white border border-zinc-300 rounded-lg text-[15px] text-zinc-900 focus:outline-none focus:border-zinc-400" />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[11px] uppercase tracking-wider text-zinc-700 font-semibold">Estimated deal value ($)</span>
              <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="—" className="px-3 py-1.5 bg-white border border-zinc-300 rounded-lg text-[15px] text-zinc-900 focus:outline-none focus:border-zinc-400" />
            </label>
            <div className="sm:col-span-2 flex items-center gap-2 justify-end">
              <button onClick={() => setEditing(false)} className="text-[13px] text-zinc-700 hover:text-zinc-900 px-3 py-1.5">Cancel</button>
              <button onClick={saveEdit} disabled={editSaving} className="text-[13px] font-semibold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}

        {/* A client email that reads like a change of plan. The card is a
            suggestion with the sentence quoted — Mark lost… is the same
            modal as the menu; nothing is applied without the click. */}
        <JobEmailSignalsCard jobId={job.id} onMarkLost={() => setMarkLostOpen(true)} />

        {/* Metadata — the four numbers an agent scans, one row. The
            production enum lives with its picker in the hero footer;
            created/updated are housekeeping, demoted there too. */}
        {/* The dash parade is gone: a cell renders its number when it has
            one, a quiet stage hint when the number simply hasn't happened
            yet, and not at all when it would only say zero. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Meta label="Agent" value={job.agent?.name || '—'} />
          {canSeeMoney && dealValue != null && dealValue > 0 && (
            <Meta label="Deal Value" value={fmtMoney(dealValue)} sub={dealValueLabel} />
          )}
          {(job.orders.length > 0 || job.rwOrderCount > 0) && (
            <Meta
              label="Orders"
              value={String(job.orders.length > 0 ? job.orders.length : job.rwOrderCount)}
              sub={
                job.orders.length > 0
                  ? job.rwOrderCount > 0 ? `+${job.rwOrderCount} RW` : undefined
                  : job.rwOrderCount > 0 ? 'RentalWorks' : undefined
              }
            />
          )}
        </div>

        {/* Phase 7 Pass A — at-a-glance engagement rollup. Each chip
            is computed from the expanded payload (no extra fetches).
            Hidden when the job has zero non-cancelled orders — the
            chips read as garbage during the QUOTED-no-order phase. */}
        {/* Agreement chips used to render here too — deleted: they said
            what the Paperwork tiles 100px below already say. Balance due
            and Loaded ready stay; no other surface rolls those up. */}
        {liveOrders.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
            {canSeeMoney && liveInvoices.length > 0 && (
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

        {/* Hero footer — housekeeping row. Production enum + its profile
            picker (drives the fleet-assignment optimizer; saving refreshes
            the Company most-common-profile cache) on the left, timestamps
            on the right. One quiet line instead of two hero rows. */}
        <div className="mt-5 pt-3 border-t border-zinc-200 flex items-center gap-3 flex-wrap">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
            Production · {job.productionType.replace('_', ' ')}
          </div>
          <div className="w-64">
            <ProductionTypeProfilePicker
              value={job.productionTypeProfileId}
              onChange={(id) => { void saveProfile(id); }}
              disabled={profileSaving}
              size="compact"
            />
          </div>
          {profileSaving && <span className="text-[11px] text-zinc-600">Saving…</span>}
          {/* Which market serves this production. Recorded on the job, not
              derived: the fleet is location-blind, so nothing else in the
              system can infer it. */}
          <label className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
              Market
            </span>
            <select
              value={job.marketId ?? ''}
              onChange={(e) => { void saveMarket(e.target.value); }}
              disabled={marketSaving || markets.length === 0}
              className="text-[12px] rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-800 disabled:opacity-60"
            >
              {/* Present only while genuinely unset, so it can't be picked
                  back to "unknown" by accident once someone has answered. */}
              {!job.marketId && <option value="">Not set</option>}
              {markets.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          {marketSaving && <span className="text-[11px] text-zinc-600">Saving…</span>}
          <div className="ml-auto text-[11px] text-zinc-600">
            Created {fmtDate(job.createdAt)} · Updated {relativeAge(job.updatedAt)}
          </div>
        </div>
      </div>

      {/* Possible duplicate job. The nightly Planyo import flags this
          itself and used to say so only in a 6 AM Slack alert — which is
          how "WS" and "WS-RK" ran as two jobs for two days (2026-09-09).
          Rendered on BOTH sides of the pairing: whoever opened the twin
          that is missing the paperwork is exactly who needs to see it.
          Same derivation as the /jobs action-items panel. */}
      {(job as { duplicateSignals?: DuplicateSignal[] }).duplicateSignals?.map((sig) => (
        <div
          key={sig.eventId}
          className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-amber-900">
                {sig.mode === 'created_sibling'
                  ? 'This job may be a duplicate'
                  : 'Confirm this booking is on the right job'}
              </div>
              <div className="mt-1 text-[13px] text-amber-900/90">{sig.sentence}</div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {sig.others.map((o) => (
                  <Link
                    key={o.jobId}
                    href={`/jobs/${o.jobId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[13px] text-amber-900 hover:border-amber-500 transition-colors"
                  >
                    <span className="font-mono text-[11px] font-bold tracking-wide">{o.jobCode}</span>
                    <span className="truncate max-w-[16rem]">{o.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Paperwork status strip — glanceable client-paperwork state.
          COI + Rental Agreement jump to their sections; Card Auth carries
          the "Send CC request" action (client authorizes in their portal). */}
      <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Paperwork</h2>
          <div className="flex items-center gap-3">
            {stripScored ? (
              <span className="flex items-center gap-2 text-[12px] text-zinc-600">
                {/* The progress bar, in the job's stage color — the same
                    wash the reservations bar carries. */}
                <span
                  className="inline-block w-20 h-2 rounded-sm bg-zinc-200 border border-zinc-300"
                  style={readinessMeterStyle(readiness.done, readiness.total, { stage, light: true })}
                  aria-hidden="true"
                />
                <span>
                  {readiness.done} of {readiness.total} complete
                  {readiness.ready && <span className="text-emerald-700 font-semibold"> · Ready to go out</span>}
                </span>
              </span>
            ) : (
              <span className="text-[12px] text-zinc-600">scoring starts when a reservation or order lands</span>
            )}
            {/* The client's own copy of this strip. Named recipient for the
                same reason "Send for signature → Mikey" carries one: nobody
                should have to guess who an email reaches before pressing it.
                The modal previews it and the send is a separate decision. */}
            <button
              onClick={sendPaperworkSummary}
              disabled={!primaryContact}
              title={
                primaryContact
                  ? `Previews a paperwork status email to ${primaryContact.person.email} — what is on file, what is still needed, with a link on each`
                  : 'Add a contact to this job first'
              }
              className="text-[12px] font-semibold text-amber-700 hover:text-amber-600 border border-zinc-200 hover:border-amber-400 rounded-lg px-2.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {primaryContact
                ? `Send summary → ${primaryContact.person.firstName}`
                : 'Send summary'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* COI */}
          <a href="#coi" className="group rounded-lg border border-zinc-200 bg-zinc-50 hover:border-amber-400 p-3.5 transition-colors">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">Certificate of Insurance</div>
            {!stripScored && coiStatus === 'Missing' ? (
              <>
                {/* A new job without a COI is a normal new job — neutral,
                    with the next step, not a rose scolding. */}
                <div className="mt-2.5 flex items-center gap-2 text-[14px] font-semibold text-zinc-600">
                  <span className="w-2 h-2 rounded-full bg-zinc-300" />
                  Not yet
                </div>
                <div className="mt-1.5 text-[12px] text-zinc-600">Open to copy the client drop link</div>
              </>
            ) : (
              <>
                <div className={`mt-2.5 flex items-center gap-2 text-[15px] font-bold ${
                  coiStatus === 'Verified' ? 'text-emerald-700' : coiStatus === 'Missing' || coiStatus === 'Expired' || coiStatus === 'Rejected' ? 'text-rose-700' : 'text-amber-700'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${coiStatus === 'Verified' ? 'bg-emerald-500' : coiStatus === 'Missing' || coiStatus === 'Expired' || coiStatus === 'Rejected' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                  {coiStatus}
                </div>
                <div className="mt-1.5 text-[12px] text-zinc-700">{coiStatus === 'Missing' ? 'Action needed' : coiStatus === 'Verified' ? 'On file & verified' : coiStatus === 'Rejected' ? 'We turned it down — the client owes a corrected one' : coiStatus === 'Expired' ? 'Policy has lapsed' : coiPendingWhy}</div>
              </>
            )}
          </a>
          {/* Rental Agreement */}
          <a href="#agreement" className="group rounded-lg border border-zinc-200 bg-zinc-50 hover:border-amber-400 p-3.5 transition-colors">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">Rental Agreement</div>
            <div className={`mt-2.5 flex items-center gap-2 text-[15px] font-bold ${
              agreementStatus === 'signed' ? 'text-emerald-700' : agreementStatus === 'expired' ? 'text-rose-700' : agreementStatus === 'pending' ? 'text-amber-700' : 'text-zinc-700'
            }`}>
              <span className={`w-2 h-2 rounded-full ${agreementStatus === 'signed' ? 'bg-emerald-500' : agreementStatus === 'expired' ? 'bg-rose-500' : agreementStatus === 'pending' ? 'bg-amber-500' : 'bg-zinc-400'}`} />
              {agreementStatus === 'signed' ? 'On file' : agreementStatus === 'pending' ? 'Pending' : agreementStatus === 'expired' ? 'Expired' : stripScored ? 'Not linked' : 'Not yet'}
            </div>
            <div className="mt-1.5 text-[12px] text-zinc-700">{agreementStatus === 'signed'
                ? 'Coverage on file'
                : !stripScored && agreementStatus === 'none'
                  ? 'Sends with the quote'
                  : SHOW_AGREEMENT_ON_FILE
                    ? 'Attach to cover'
                    : 'Send for signature'}</div>
          </a>
          {/* Card Authorization — `id` is the deep-link target for the
              CC Auth chip in the reservation pop-up on /gantt. */}
          <div id="card-auth" className="scroll-mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">Card Authorization</div>
            {cardOnFile ? (
              <>
                <div
                  className={`mt-2.5 flex items-center gap-2 text-[15px] font-bold ${
                    cardWarn ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${cardWarn ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  />
                  On file{job.cardAuth.last4 ? ` · ····${job.cardAuth.last4}` : ''}
                </div>
                <div className="mt-1.5 text-[12px] text-zinc-700">
                  {/* A card the gateway refused reads as "on file" everywhere
                      and fails at charge time. Say it here, where someone can
                      still ask for another card before the rental goes out. */}
                  {!job.cardAuth.validated
                    ? 'The $0 check was not approved — ask for another card'
                    : job.cardAuth.expired
                      ? 'That card has expired — ask for another'
                      : cardSecurityOnly ? 'Security only — client pays another way' : cardPrefUndecided ? 'Payment method not chosen yet' : job.cardAuth.cardholderName || 'Authorized'}
                </div>
                {/* Where the card came from. An account card was NOT authorized
                    for this job — staff keyed it from paper the client signed
                    elsewhere — so the tile says so rather than implying this
                    client sat down and typed it into the portal. */}
                {cardFromAccount && (
                  <div className="mt-1 text-[11px] text-zinc-500">
                    On the {job.company?.name || 'client'} account
                    {job.cardAuth.authorizationRef ? ` · ${job.cardAuth.authorizationRef}` : ''}
                    {job.company?.id ? (
                      <>
                        {' '}
                        <a
                          href={`/crm/${job.company.id}#cards`}
                          className="underline underline-offset-2 hover:text-zinc-900"
                        >
                          view
                        </a>
                      </>
                    ) : null}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Status first — same grammar as the other four tiles;
                    the rose dot is the "act here", the action sits below.
                    No "needs a reservation first" state any more: a job
                    is enough to ask for a card (Wes 2026-09-05), and the
                    send route creates the booking it hangs off. */}
                <div className="mt-2.5 flex items-center gap-2 text-[15px] font-bold text-rose-700">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Missing
                </div>
                <div className="mt-1.5 text-[12px] text-zinc-600">
                  <button
                    onClick={sendCcRequest}
                    className="font-semibold text-amber-700 hover:text-amber-700"
                  >
                    ↗ Send CC request
                  </button>
                  {' '}&middot;{' '}
                  <button
                    onClick={copyCcLink}
                    disabled={ccBusy}
                    className="underline underline-offset-2 hover:text-zinc-900 disabled:opacity-50"
                  >
                    {ccBusy ? 'copying…' : 'copy link'}
                  </button>
                </div>
                {/* The link is out. From here the yard will not release the
                    job without a card — say so where the agent is looking,
                    not at the gate on pickup morning (Wes 2026-09-06). */}
                {job.cardAuth.requestSentAt && (
                  <div className="mt-1.5 text-[11px] text-rose-700 font-semibold">
                    Link sent {new Date(job.cardAuth.requestSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' '}· the yard can&apos;t check this job out until a card is on file
                  </div>
                )}
                {/* The client HAS tried. Sending them the link again is the
                    wrong move — call them, or key in a signed authorization. */}
                {job.cardAuth.troubleCount > 0 && (
                  <div className="mt-1.5 text-[11px] text-rose-700 font-semibold">
                    Client tried {job.cardAuth.troubleCount}×{' '}
                    {job.cardAuth.lastTroubleAt
                      ? `· last ${new Date(job.cardAuth.lastTroubleAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                      : ''}
                    {job.cardAuth.lastTroubleDetail ? ` · ${job.cardAuth.lastTroubleDetail}` : ''}
                  </div>
                )}
                {/* The client already signed a CCA on paper? It gets keyed
                    into the company's wallet rather than asking them to do
                    it again in the portal (Wes 2026-09-02). Collections-
                    gated over there, so most people see nothing. */}
                {job.company?.id && (
                  <div className="mt-1 text-[11px] text-zinc-500">
                    <a
                      href={`/crm/${job.company.id}?job=${job.id}#cards`}
                      className="underline underline-offset-2 hover:text-zinc-900"
                    >
                      Already have a signed authorization? Key it in
                    </a>
                  </div>
                )}
              </>
            )}
          </div>
          {/* Driver — a name on every assigned unit. */}
          <a href="#drivers" className="group rounded-lg border border-zinc-200 bg-zinc-50 hover:border-amber-400 p-3.5 transition-colors">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">Drivers Named</div>
            {activeAssignments.length === 0 ? (
              <>
                {/* Vacuously true is not "All named" — with zero units the
                    honest reading is that the question hasn't started. */}
                <div className="mt-2.5 text-[15px] font-semibold text-zinc-600">—</div>
                <div className="mt-1.5 text-[12px] text-zinc-600">No units yet</div>
              </>
            ) : (
              <>
                <div className={`mt-2.5 flex items-center gap-2 text-[15px] font-bold ${driverBlocked ? 'text-amber-700' : 'text-emerald-700'}`}>
                  <span className={`w-2 h-2 rounded-full ${driverBlocked ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  {driverBlocked ? 'Missing drivers' : 'All named'}
                </div>
                <div className="mt-1.5 text-[12px] text-zinc-700">
                  {driverBlocked ? 'A unit has no driver yet' : 'Every unit has a driver'}
                </div>
              </>
            )}
          </a>
          {/* Gear — units picked for every live hold. Internal (Julian),
              so it jumps to the reservations rather than chasing a client. */}
          <a href="#reserved-assets" className="group rounded-lg border border-zinc-200 bg-zinc-50 hover:border-amber-400 p-3.5 transition-colors">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">Gear Assigned</div>
            {liveHoldItems.length === 0 ? (
              <>
                <div className="mt-2.5 text-[15px] font-semibold text-zinc-600">—</div>
                <div className="mt-1.5 text-[12px] text-zinc-600">No holds yet</div>
              </>
            ) : (
              <>
                <div className={`mt-2.5 flex items-center gap-2 text-[15px] font-bold ${gearBlocked ? 'text-amber-700' : 'text-emerald-700'}`}>
                  <span className={`w-2 h-2 rounded-full ${gearBlocked ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  {gearBlocked ? 'Units to pick' : 'All assigned'}
                </div>
                <div className="mt-1.5 text-[12px] text-zinc-700">
                  {gearBlocked ? 'A hold has no unit yet' : 'Every hold has a unit'}
                </div>
              </>
            )}
          </a>
          {/* Final Invoice — the far end of the same story. The five tiles
              left of this one ask whether the job can go OUT; this one asks
              whether it has been billed and whether the client knows how to
              pay. That state lived only in the panel below and in the
              Collections queue (Wes 2026-09-02). */}
          {canSeeMoney && (
          <FinalInvoiceTile
            jobId={job.id}
            onUpload={() => {
              openSection('money');
              setFinalInvoiceOpen((n) => n + 1);
            }}
            hqInvoices={liveInvoices.map((i) => ({
              id: i.id,
              invoiceNumber: i.invoiceNumber,
              status: i.status,
              total: i.total,
              sentAt: i.sentAt ? String(i.sentAt) : null,
            }))}
          />
          )}
        </div>
      </div>

      {/* Certificate of Insurance — the compliance record. Client-drop
          uploads land here via the portal link; offline COIs (email,
          broker, RentalWorks) are attached with "Upload COI" so HQ stays
          the source of truth without a re-sign. */}
      {showSec('coi') && (
      <div id="coi" className="scroll-mt-4 bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Certificate of Insurance</h2>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              coiStatus === 'Verified' ? 'bg-emerald-100 text-emerald-700'
                : coiStatus === 'Pending' ? 'bg-amber-100 text-amber-700'
                : 'bg-rose-100 text-rose-700'
            }`}>{coiStatus}</span>
          </div>
          <div className="flex items-center gap-3">
            <CopyCoiLinkButton jobId={job.id} variant="dark" />
            <button
              onClick={() => setCoiModalOpen(true)}
              className="text-[13px] font-semibold bg-zinc-100 hover:bg-zinc-200 text-amber-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              + Upload COI
            </button>
          </div>
        </div>
        {job.coiChecks.length === 0 ? (
          // A job with no certificate is usually one nobody has sent yet —
          // but it can also be one the production PULLED off the account
          // policy. Those need opposite things from the desk, so they never
          // read the same. Wes, 2026-09-09.
          job.coiSeparatePolicy ? (
            <div className="rounded-xl border border-chip-warn-fg/20 bg-chip-warn-bg px-4 py-3 space-y-1">
              <p className="text-[15px] text-chip-warn-fg">{job.coiSeparatePolicy.sentence}</p>
              {job.coiSeparatePolicy.note && (
                <p className="text-[13px] text-lt-fg2">&ldquo;{job.coiSeparatePolicy.note}&rdquo;</p>
              )}
              <p className="text-[12px] text-lt-fg3">
                Told to us{job.coiSeparatePolicy.confirmerName ? ` by ${job.coiSeparatePolicy.confirmerName}` : ''}
                {job.coiSeparatePolicy.decidedAt ? ` on ${fmtDate(job.coiSeparatePolicy.decidedAt)}` : ''} in the
                client portal.
              </p>
            </div>
          ) : (
            <div className="text-[15px] text-zinc-700 border border-dashed border-zinc-200 rounded-xl px-4 py-4 text-center bg-zinc-50">
              No certificate on file. Upload one the client sent by email or broker, or use
              <span className="text-zinc-700"> Copy COI link</span> to have them drop it in.
            </div>
          )
        ) : (
          <div className="space-y-2">
            {/* Only workers' comp on file: it is listed, but the job still has
                no certificate that insures the rental (LAFSC, 2026-09-11). */}
            {!governingCoiRow && (
              <div className="text-[13px] text-chip-warn-fg bg-chip-warn-bg rounded-lg px-3.5 py-2">
                Workers&apos; comp only — no general liability / auto certificate on file for this job yet.
              </div>
            )}
            {job.coiChecks.map((c) => {
              const verified = c.coverageVerified || c.humanDecision === 'APPROVED';
              const expired = !!c.policyExpiryDate && new Date(c.policyExpiryDate) < new Date();
              const rowStatus = verified ? (expired ? 'Expired' : 'Verified')
                : c.humanDecision === 'REJECTED' ? 'Rejected' : 'Pending';
              const rowTone = rowStatus === 'Verified' ? 'text-emerald-700 bg-emerald-50'
                : rowStatus === 'Pending' ? 'text-amber-700 bg-amber-50'
                : 'text-rose-700 bg-rose-50';
              const src = c.source === 'CLIENT_UPLOAD' ? 'Client upload'
                : c.source === 'INTERNAL' ? 'Filed by agent' : 'On file';
              // Does the certificate insure the production we papered? Computed
              // on every render against the job's CURRENT company + production
              // name, so correcting a wrong company clears the flag here without
              // re-reviewing the certificate.
              const match = evaluateInsuredMatch(c.namedInsured, [job.company?.name, job.name]);
              // SETTLED = signed off, in date, and insuring the right
              // entity. Wes 2026-09-01: an approved certificate kept
              // offering a prominent "Review", which reads as "this
              // still needs reviewing" — so an approval never felt
              // like it finished anything. A settled row states it is
              // complete and demotes the way back in to a quiet link;
              // anything unsettled keeps the loud button.
              const settled =
                c.humanDecision === 'APPROVED' && !expired && !match.needsAttention;
              return (
                <div key={c.id} className={`rounded-lg border px-3.5 py-2.5 ${match.needsAttention ? 'border-rose-300 bg-rose-50' : 'border-zinc-200 bg-zinc-50'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${rowTone}`}>{rowStatus}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] text-zinc-900 truncate">{c.originalFilename}</span>
                        {c.documentKind === 'WORKERS_COMP' && (
                          <span
                            title="Covers workers' comp only — the job still needs its general liability / auto certificate"
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 bg-chip-neutral-bg text-chip-neutral-fg"
                          >
                            Workers&apos; comp
                          </span>
                        )}
                        {c.aiRiskLevel && (
                          <span
                            title={`AI review: ${c.aiRecommendation === 'accept' ? 'passes checks' : 'needs review'}`}
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 ${
                              c.aiRiskLevel === 'low' ? 'bg-emerald-50 text-emerald-700'
                                : c.aiRiskLevel === 'high' ? 'bg-rose-50 text-rose-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            AI · {c.aiRiskLevel} risk
                          </span>
                        )}
                        {match.verdict !== 'UNKNOWN' && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 ${INSURED_MATCH_TONE_LIGHT[match.verdict]}`}>
                            {INSURED_MATCH_LABEL[match.verdict]}
                          </span>
                        )}
                        {/* Carried from the account. Whether the production
                            has said it covers THIS job is a separate fact
                            from whether the certificate is good — an
                            unconfirmed one is still coverage. */}
                        {c.confirmationWord && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 ${
                              c.confirmationState === 'CONFIRMED'
                                ? 'bg-chip-good-bg text-chip-good-fg'
                                : 'bg-chip-neutral-bg text-chip-neutral-fg'
                            }`}
                          >
                            {c.confirmationWord}
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-zinc-700">
                        {src} · added {fmtDate(c.createdAt)}
                        {c.policyExpiryDate && <> · expires {fmtDate(c.policyExpiryDate)}</>}
                        {c.namedInsured && <> · insures {c.namedInsured}</>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {settled ? (
                        <span
                          className="text-[12px] font-semibold text-emerald-700 flex items-center gap-1.5"
                          title={
                            c.humanDecisionAt
                              ? `Approved ${fmtDate(c.humanDecisionAt)}`
                              : 'Approved'
                          }
                        >
                          <span aria-hidden><Check size={16} aria-hidden /></span> Complete
                        </span>
                      ) : (
                        <button
                          onClick={() => setReviewCoiId(c.id)}
                          className="text-[13px] font-semibold bg-zinc-100 hover:bg-zinc-200 text-zinc-900 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Review
                        </button>
                      )}
                      {settled && (
                        <button
                          onClick={() => setReviewCoiId(c.id)}
                          className="text-[12px] text-zinc-600 hover:text-zinc-700 underline underline-offset-2"
                        >
                          Reopen
                        </button>
                      )}
                      <a
                        href={`/api/coi/download/${c.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] font-semibold text-amber-700 hover:text-amber-700"
                      >
                        View PDF →
                      </a>
                    </div>
                  </div>
                  {/* The mismatch is stated in full on the row: a certificate
                      insuring somebody else covers nothing if a unit is
                      damaged, and that is not a detail to hide behind a click. */}
                  {match.needsAttention && (
                    <div className="mt-2 text-[12px] text-rose-800 leading-relaxed">
                      {match.message}{' '}
                      <button
                        onClick={() => setReviewCoiId(c.id)}
                        className="font-semibold text-amber-700 hover:text-amber-800 underline underline-offset-2"
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
        {/* The number the broker needs for the equipment line of that
            certificate. Sits inside the COI section because that is the
            conversation it belongs to; money-gated like the order page. */}
        {canSeeMoney && job.replacementValue && job.replacementValue.counted > 0 && (
          <div className="mt-3">
            <ReplacementValueCard value={job.replacementValue} scope="job" compact />
          </div>
        )}
      </div>
      )}

      {/* Workers' Comp — the client's separate WC proof when it isn't
          carried on the main COI (payroll companies issue their own).
          Sits directly under COI: both are insurance documents, and a rep
          chasing coverage reads them together. Empty state is explanatory
          rather than alarming — WC on the main COI is the common case and
          needs no separate upload. */}
      {showSec('wc') && (
      <div id="wc" className="scroll-mt-4 bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
        <div className="flex items-center gap-2.5 mb-2.5">
          <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Workers&rsquo; Compensation</h2>
          {wcCerts.length > 0 && (
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              wcCerts.some((w) => w.pass) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>{wcCerts.some((w) => w.pass) ? 'Verified' : 'Needs review'}</span>
          )}
        </div>
        {wcCerts.length === 0 ? (
          <div className="text-[15px] text-zinc-700 border border-dashed border-zinc-200 rounded-xl px-4 py-4 text-center bg-zinc-50">
            No separate certificate on file. Workers&rsquo; Comp is usually carried on the
            main COI above — a separate upload is only needed when the client&rsquo;s payroll
            company (EP, Cast &amp; Crew, ADP&hellip;) issues its own.
          </div>
        ) : (
          <div className="space-y-2">
            {wcCerts.map((w) => {
              const tone = w.expired ? 'text-rose-700 bg-rose-50'
                : w.pass ? 'text-emerald-700 bg-emerald-50'
                : 'text-amber-700 bg-amber-50';
              const label = w.expired ? 'Expired' : w.pass ? 'Verified' : 'Needs review';
              return (
                <div key={w.id} className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${tone}`}>{label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] text-zinc-900 truncate">{w.filename}</div>
                    <div className="text-[12px] text-zinc-700">
                      {w.provider ? `${w.provider}` : 'Client upload'}
                      {w.uploadedAt && <> &middot; added {fmtDate(w.uploadedAt)}</>}
                      {w.expiryDate && <> &middot; expires {w.expiryDate}</>}
                    </div>
                    {w.issues.length > 0 && (
                      <div className="text-[12px] text-amber-700 mt-0.5 truncate" title={w.issues.join(' · ')}>
                        {w.issues.join(' · ')}
                      </div>
                    )}
                  </div>
                  <a
                    href={`/api/wc/download/${w.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] font-semibold text-amber-700 hover:text-amber-700 flex-shrink-0"
                  >
                    View PDF &rarr;
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Rental / stage agreement — job-level coverage. A job is attached
          as an addendum to an on-file (often annual) master agreement. */}
      {showSec('agreement') && (
      <div id="agreement" className="scroll-mt-4 bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Rental &amp; Stage Agreement</h2>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              agreementStatus === 'signed' ? 'bg-emerald-100 text-emerald-700'
                : agreementStatus === 'pending' ? 'bg-amber-100 text-amber-700'
                : agreementStatus === 'expired' ? 'bg-rose-100 text-rose-700'
                : 'bg-zinc-100 text-zinc-700'
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
                  : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
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
              className="text-[13px] font-semibold bg-zinc-100 hover:bg-zinc-200 text-emerald-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {fileSignedBusy ? 'Filing…' : '↑ Upload signed agreement'}
            </button>
            {SHOW_AGREEMENT_ON_FILE && (
              <button
                onClick={() => setAgreementModalOpen(true)}
                className="text-[13px] font-semibold bg-zinc-100 hover:bg-zinc-200 text-amber-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                + Link agreement
              </button>
            )}
          </div>
        </div>
        {fileSignedMsg && (
          <div className="mb-2.5 text-[12px] text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
            {fileSignedMsg}
          </div>
        )}
        {namePromptOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-lt-card border border-lt-hairline rounded-xl w-full max-w-md p-5">
              <h3 className="text-base font-semibold text-lt-fg">Name this show first</h3>
              <p className="text-sm text-lt-fg2 mt-1.5 leading-relaxed">
                This job has no name yet. It prints on the rental agreement the client signs and
                headlines their portal, so it needs to be the show&apos;s real name — not
                &ldquo;Reservation&rdquo;.
              </p>
              <input
                autoFocus
                value={namePromptValue}
                onChange={(e) => setNamePromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveNameThenSend();
                  if (e.key === 'Escape') setNamePromptOpen(false);
                }}
                placeholder="e.g. TJ Maxx Holiday Spot"
                className="mt-3 w-full px-3 py-2 bg-white border border-lt-hairline rounded-lg text-[15px] text-lt-fg focus:outline-none focus:border-lt-fg3"
              />
              {namePromptError && <p className="text-xs text-chip-bad-fg mt-2">{namePromptError}</p>}
              <div className="flex items-center justify-end gap-2 mt-4">
                <button
                  onClick={() => setNamePromptOpen(false)}
                  className="text-sm text-lt-fg2 hover:text-lt-fg px-3 py-2"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveNameThenSend()}
                  disabled={namePromptBusy || namePromptValue.trim().length < 2}
                  className="text-sm font-semibold px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40"
                >
                  {namePromptBusy ? 'Saving…' : 'Save name and send'}
                </button>
              </div>
            </div>
          </div>
        )}
        {signSendMsg && (
          <div className="mb-2.5 text-[12px] text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 break-all">
            {signSendMsg}
          </div>
        )}
        {/* Annual account: say WHY nobody was asked to sign, and name the
            document. Without this line the section reads as a job whose
            paperwork was never chased. */}
        {job.annualCoverage && (
          <div className="mb-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-emerald-700 bg-emerald-50 border border-emerald-200">
                Annual account
              </span>
              <span className="text-[15px] text-zinc-900 font-medium">
                {job.annualCoverage.title}
              </span>
            </div>
            <div className="mt-1 text-[12px] text-emerald-900">
              Covered by the company&rsquo;s annual agreement
              {job.annualCoverage.expiryDate
                ? ` through ${fmtDay(job.annualCoverage.expiryDate)}`
                : ''}
              . The client is not asked to sign a rental agreement for this job — only the
              damage-waiver election below.
            </div>
            <a
              href={`/api/agreements/company/${job.annualCoverage.companyAgreementId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-block text-[13px] font-semibold text-emerald-800 hover:text-emerald-900"
            >
              View agreement →
            </a>
          </div>
        )}

        {/* The waiver election. Rendered whenever the company is on an annual
            agreement (where it is the whole ask) or an answer already exists;
            otherwise the per-booking chips still carry it and a second
            surface would just be two places to disagree. */}
        {(job.annualCoverage || job.lcdwElection) && (
          <div className="mb-2.5">
            <JobLcdwPanel
              jobId={job.id}
              election={job.lcdwElection}
              hasAnnualCoverage={!!job.annualCoverage}
              onChanged={load}
            />
          </div>
        )}

        {/* "No signed paperwork on this job yet" was measured against
            addenda alone, so a job whose client HAD signed in the portal
            read empty while the header chip two lines up said On file. The
            empty state now has to be empty on both counts. */}
        {/* An annual account is covered whether or not an addendum row exists
            yet — the addendum is cut when the client elects LCDW. Telling
            staff "this job isn't linked to an agreement" while the banner
            above says it's covered is the contradiction this guard removes. */}
        {job.annualCoverage ? null : job.agreementAddenda.length === 0 && signedOrderAgreements.length === 0 ? (
          <div className="text-[15px] text-zinc-700 border border-dashed border-zinc-200 rounded-xl px-4 py-4 text-center bg-zinc-50">
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
                <div key={ad.id} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${expired ? 'text-rose-700 bg-rose-50' : 'text-emerald-700 bg-emerald-50'}`}>
                      {expired ? 'Expired' : 'On file'}
                    </span>
                    <span className="text-[15px] text-zinc-900 font-medium">{ca.title || ca.contractType.replace(/_/g, ' ')}</span>
                    <span className="text-[11px] uppercase tracking-wider text-zinc-700">{ca.contractType.replace(/_/g, ' ')}</span>
                    {ca.isAnnual && (
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 uppercase tracking-wider">Annual</span>
                    )}
                  </div>
                  <div className="mt-1 text-[12px] text-zinc-700">
                    added {fmtDate(ad.createdAt)}
                    {ca.isAnnual && ca.effectiveDate && <> · covers {fmtDay(ca.effectiveDate)}{ca.expiryDate ? ` – ${fmtDay(ca.expiryDate)}` : ''}</>}
                    {ad.note && <> · {ad.note}</>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <a
                      href={`/api/agreements/company/${ca.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] font-semibold text-amber-700 hover:text-amber-700"
                    >
                      View agreement →
                    </a>
                    {ad.addendumFileUrl && (
                      <a
                        href={`/api/agreements/addendum/${ad.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] font-semibold text-amber-700 hover:text-amber-700"
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
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1.5">Order agreements</div>
            <div className="space-y-2">
              {signedOrderAgreements.map(({ order, agreement: a }) => {
                const executed = isSignedAgreementStatus(a.status);
                return (
                  <div key={a.id} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${executed ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'}`}>
                        {a.status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[15px] text-zinc-900 font-medium">
                        {a.contractType === 'STAGE_CONTRACT' ? 'Stage contract' : 'Rental agreement'}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-700">{order.orderNumber}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-zinc-700">
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
                            className="text-[13px] font-semibold text-amber-700 hover:text-amber-700"
                          >
                            View signed PDF →
                          </a>
                          <a
                            href={`/api/orders/${order.id}/agreement/pdf?type=${a.contractType}&doc=signed&download=1`}
                            download
                            className="text-[13px] font-semibold text-zinc-700 hover:text-zinc-900"
                          >
                            Download
                          </a>
                        </>
                      ) : (
                        <span className="text-[12px] text-zinc-600">No executed PDF filed for this one.</span>
                      )}
                      {/* The client redlined this one. Entering it here beats
                          sending people to the order page to find the same
                          action — the job page is where paperwork is worked. */}
                      {/* Two different things, and they were wearing the same
                          words. On an agreement that already HAS a redline this
                          is a link to that redline; on one that does not it is
                          the way to enter one. Rendering "Client sent a redline"
                          on both read as two redlines having arrived. */}
                      {!executed && a.contractType === 'RENTAL_AGREEMENT' && (
                        a.contractReviewId ? (
                          <Link
                            href={`/tools/contract-review/${a.contractReviewId}`}
                            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-rose-700 hover:text-rose-800"
                          >
                            <AlertTriangle size={13} aria-hidden />
                            Redline on file — open it →
                          </Link>
                        ) : (
                          <button
                            onClick={() =>
                              setRedlineOrder({ id: order.id, orderNumber: order.orderNumber })
                            }
                            className="text-[13px] font-semibold text-amber-700 hover:text-amber-800"
                          >
                            Client sent a redline →
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Reservations — one row per booking, with where it came from.
          Above the unit grid on purpose: two cards for two vans look
          identical whether that is one two-van rental or the same rental
          held twice, and only the booking-level view separates them. */}
      {showSec('reservations') && (
      <JobBookingsSection
        bookings={(job.bookings ?? []).map((b: any) => ({
          id: b.id,
          bookingNumber: b.bookingNumber,
          status: b.status,
          startDate: b.startDate,
          endDate: b.endDate,
          planyoCartId: b.planyoCartId ?? null,
          source: b.source ?? null,
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
      )}

      {/* Reserved assets → each opens its reservation on the calendar */}
      {showSec('assets') && (
      <div id="reserved-assets" className="scroll-mt-4 bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Reserved assets</h2>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-zinc-600">
              {reservedAssets.length} unit{reservedAssets.length === 1 ? '' : 's'}
              {pendingHolds.length > 0 && ` · ${pendingHolds.length} held`}
            </span>
            <AddAssetButton
              // Derived span, same as JobQuickActions above. This read
              // job.startDate/endDate, which the API stopped sending long
              // before the columns were dropped — so the hold picker was
              // silently defaulting to today on every job.
              job={{ id: job.id, jobCode: job.jobCode, name: job.name, company: { id: job.company.id, name: job.company.name }, startDate: isoDate(orderSpan.start), endDate: isoDate(orderSpan.end) }}
              onCreated={load}
            />
          </div>
        </div>
        {reservedAssets.length === 0 && pendingHolds.length === 0 ? (
          <div className="mt-3 text-[15px] text-zinc-700">No units reserved on this job yet — use + Add asset to hold one.</div>
        ) : (
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {reservedAssets.map((a) => (
              <div
                key={a.assetId}
                className="group rounded-xl border border-zinc-200 bg-zinc-50 hover:border-amber-400 hover:bg-zinc-100 p-3 transition-all duration-200 hover:-translate-y-0.5"
              >
              <Link
                href={`/gantt?date=${a.startDate.slice(0, 10)}`}
                title="Open this reservation on the calendar"
                className="block"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <svg className="w-4 h-4 shrink-0 text-amber-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2.6 20.5 7v10L12 21.4 3.5 17V7z" />
                      <path d="M3.5 7 12 11.6 20.5 7" />
                      <path d="M12 11.6v9.8" />
                    </svg>
                    <span className="font-semibold text-zinc-900 group-hover:text-amber-700 transition-colors truncate">{a.unitName}</span>
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
                          ? { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'LCDW', title: 'LCDW accepted — SirReel waives the first $1,000 in collision damage ($24/day/vehicle)' }
                          : lcdw === 'DECLINED'
                            ? { cls: 'bg-white text-zinc-600 border-zinc-300', label: 'LCDW declined', title: 'LCDW declined — the client carries their own collision coverage' }
                            : { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'LCDW?', title: 'LCDW not answered yet — the client has not accepted or declined the waiver' };
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
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${ASSIGN_BADGE[a.status] ?? 'bg-zinc-100 text-zinc-700 border-zinc-300'}`}>
                      {a.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <div className="mt-0.5 text-[12px] text-zinc-700 truncate">{a.category}</div>
                <div className="mt-1.5 text-[12px] text-zinc-700 font-mono">{fmtDay(a.startDate)} – {fmtDay(a.endDate)}</div>
                {/* Who's driving it — the question a rep asks while looking
                    at the unit, so answered here rather than only in the
                    Drivers section below. */}
                <div className="mt-1.5 text-[11px] truncate">
                  {a.drivers.length === 0 ? (
                    <span className="text-zinc-600">No driver named</span>
                  ) : (
                    <span className={driverTone(a.drivers[0])}>
                      <User size={12} aria-hidden className="inline-block align-[-1px] mr-1" />{driverName(a.drivers[0])}
                      {a.drivers.length > 1 && ` +${a.drivers.length - 1}`}
                      {' · '}{driverStateLabel(a.drivers[0])}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-[11px] text-amber-700 opacity-0 group-hover:opacity-100 transition-opacity">On calendar →</div>
              </Link>
              {/* The order this truck goes out on, and the way to write
                  one from here (Wes 2026-09-10: "when we open a
                  reservation we should be able to add a warehouse order
                  there"). The builder opens against this job and attaches
                  the saved order to THIS unit. */}
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-200 pt-2 text-[11px]">
                {a.attachedOrder ? (
                  <Link
                    href={`/orders/${a.attachedOrder.id}`}
                    className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-mono font-semibold text-violet-700 hover:bg-violet-100"
                    title="This unit goes out on this order"
                  >
                    {a.attachedOrder.orderNumber}
                  </Link>
                ) : (
                  <span className="text-zinc-500">No order on this unit</span>
                )}
                {canWriteOrders && (
                  <Link
                    href={`/orders/new?jobId=${encodeURIComponent(job.id)}&loadOnAssignmentId=${encodeURIComponent(a.bookingAssignmentId)}`}
                    className="shrink-0 font-semibold text-amber-700 hover:text-amber-800 hover:underline"
                    title={`Start a warehouse order that loads on ${a.unitName}`}
                  >
                    + Warehouse order
                  </Link>
                )}
              </div>
              </div>
            ))}
            {/* Category-level holds with no unit picked yet. These are
                REAL reservations (the quote-send soft hold lands here) —
                before this they only surfaced in the Drivers card, so a
                held category read as "nothing reserved" on this panel. */}
            {/* Two actions, so the tile is a div with buttons inside
                rather than one big button: pick the unit, or take the
                hold off the job entirely. */}
            {pendingHolds.map((h) => (
              <div
                key={h.bookingItemId}
                className="group text-left rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 transition-all duration-200"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-900 truncate">
                    {h.category}
                    {h.quantity > 1 && <span className="ml-1.5 text-zinc-600 font-normal">× {h.quantity}</span>}
                  </span>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                    Held · no unit
                  </span>
                </div>
                {h.startDate && (
                  <div className="mt-1.5 text-[12px] text-zinc-700 font-mono">
                    {fmtDay(h.startDate)}{h.endDate ? ` – ${fmtDay(h.endDate)}` : ''}
                  </div>
                )}
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setAssignHoldId(h.bookingItemId)}
                    title="Held at category level — pick the specific unit"
                    disabled={releasingHoldId != null}
                    className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 hover:underline disabled:opacity-40"
                  >
                    Assign a unit →
                  </button>
                  <button
                    type="button"
                    onClick={() => releaseHold(h)}
                    title="Release this hold — the capacity goes back to the board"
                    disabled={releasingHoldId != null}
                    className="shrink-0 rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-600 hover:border-rose-600 hover:text-rose-700 disabled:opacity-40"
                  >
                    {releasingHoldId === h.bookingItemId ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {holdReleaseError && (
          <div className="mt-2 text-[12px] font-semibold text-rose-700">{holdReleaseError}</div>
        )}
      </div>
      )}

      {/* Drivers — who's taking each unit out. Sits directly under the
          reserved assets it describes. */}
      {showSec('drivers') && (
      <JobDriversSection
        vehicles={reservedAssets.map((a) => ({
          bookingAssignmentId: a.bookingAssignmentId,
          unitName: a.unitName,
          category: a.category,
          startDate: a.startDate,
          endDate: a.endDate,
          drivers: a.drivers,
          currentDriverId: a.currentDriverId,
          unitReturned: a.unitReturned,
          driverReturnedAt: a.driverReturnedAt,
          driverReturnMileage: a.driverReturnMileage,
        }))}
        pendingHolds={pendingHolds}
        onChanged={load}
        onAssign={(bookingItemId) => setAssignHoldId(bookingItemId)}
        jobId={job.id}
        driverRequest={job.driverRequestSentAt && job.driverRequestSentTo ? { sentAt: job.driverRequestSentAt, sentTo: job.driverRequestSentTo } : null}
        askContactName={signatory ? `${signatory.person.firstName} ${signatory.person.lastName}`.trim() : null}
      />
      )}

      {assignHoldId && (
        <AssignUnitsModal
          bookingItemId={assignHoldId}
          bufferDays={1}
          onClose={() => setAssignHoldId(null)}
          onChanged={load}
        />
      )}

      {/* Sub-rentals — the partner-sourced units on this job. Self-hides
          when there are none, and self-fetches: it has its own mutations
          and most jobs never have one. Sits under Drivers because the
          block above covers OUR units and this is the rest of what's
          going out. */}
      <JobSubRentalsSection jobId={job.id} />

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

        // The client's own report-to, typed in the portal. It had a writer
        // and no reader until 2026-09-02 — a production filled in the
        // address, the times and an on-site contact, emailed her rep to say
        // she had, and there was nowhere in HQ he could look. It renders
        // FIRST because it is the one fact on this card the client asserted
        // rather than an agent transcribing a phone call.
        const pickupSame = job.pickupSameAsDelivery !== false;
        const effPickupAddress = pickupSame ? job.reportToAddress : job.pickupAddress;
        const effPickupNotes = pickupSame ? job.reportToAccessNotes : job.pickupAccessNotes;
        const hasReportTo = !!(
          job.reportToAddress || job.reportToTime || job.reportToContactName ||
          job.reportToContactPhone || job.reportToAccessNotes ||
          job.pickupAddress || job.pickupTime || job.pickupAccessNotes
        );

        // The card no longer self-hides on empty. It used to render only when
        // an order carried logistics free-text, which meant the after-hours
        // send — the one affordance here that EVERY job can use — was
        // invisible on exactly the jobs most likely to need it: a plain
        // will-call with no notes and no delivery. The panel is always
        // present now; the free-text rows below still come and go.
        return (
          <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Logistics & after-hours</h2>
              <span className="text-[11px] text-zinc-700 uppercase tracking-wider">Client-facing access + agent notes</span>
            </div>
            {/* Vehicle first: a van collected from the lot is the common
                after-hours case; gear in the container is the other one. */}
            <JobVehiclePickupPanel jobId={job.id} />
            <JobAfterHoursPanel jobId={job.id} />
            {hasReportTo && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <div className="text-[12px] font-semibold text-amber-800">
                    Where to report — entered by the client
                  </div>
                  {job.reportToUpdatedAt && (
                    <div className="text-[11px] text-zinc-600">
                      Saved {fmtDateTime(job.reportToUpdatedAt)}
                    </div>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-0.5">Delivery</div>
                    <div className="text-[13px] text-zinc-900 whitespace-pre-wrap leading-relaxed">
                      {job.reportToAddress || <span className="text-zinc-500">—</span>}
                    </div>
                    {job.reportToTime && (
                      <div className="text-[12px] text-zinc-700 mt-0.5">Time: {job.reportToTime}</div>
                    )}
                    {job.reportToAccessNotes && (
                      <div className="text-[12px] text-zinc-700 mt-0.5 whitespace-pre-wrap">{job.reportToAccessNotes}</div>
                    )}
                    {(job.reportToContactName || job.reportToContactPhone) && (
                      <div className="text-[12px] text-zinc-700 mt-0.5">
                        On site: {job.reportToContactName || '—'}
                        {job.reportToContactPhone ? ` · ${job.reportToContactPhone}` : ''}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-0.5">Pickup</div>
                    <div className="text-[13px] text-zinc-900 whitespace-pre-wrap leading-relaxed">
                      {effPickupAddress || <span className="text-zinc-500">—</span>}
                      {pickupSame && effPickupAddress && (
                        <span className="text-zinc-500 text-[12px]"> (same as delivery)</span>
                      )}
                    </div>
                    {job.pickupTime && (
                      <div className="text-[12px] text-zinc-700 mt-0.5">Time: {job.pickupTime}</div>
                    )}
                    {effPickupNotes && (
                      <div className="text-[12px] text-zinc-700 mt-0.5 whitespace-pre-wrap">{effPickupNotes}</div>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-4">
              {rows.map(({ order, dateOverrides, hasNotes, hasStageNotes, hasStageDetail }) => (
                <div key={order.id} className="border-l-2 border-amber-200 pl-3">
                  <div className="flex items-center gap-2 mb-1.5 text-[12px]">
                    <Link
                      href={`/orders/${order.id}`}
                      className="font-mono text-zinc-700 hover:text-amber-600"
                    >
                      {order.orderNumber}
                    </Link>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${ORDER_STATUS_BADGE[order.status] || 'bg-zinc-100 text-zinc-700'}`}
                    >
                      {order.status}
                    </span>
                    <span className="text-zinc-700">
                      {fmtDay(order.startDate)} – {fmtDay(order.endDate)}
                    </span>
                  </div>
                  {hasNotes && (
                    <div className="mb-2">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-0.5">Order notes</div>
                      <div className="text-[13px] text-zinc-800 whitespace-pre-wrap leading-relaxed">{order.notes}</div>
                    </div>
                  )}
                  {hasStageDetail && order.stageBookingTerms && (
                    <div className="mb-2">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-0.5">Stage terms</div>
                      <div className="text-[13px] text-zinc-700 flex flex-wrap gap-x-3 gap-y-0.5">
                        {order.stageBookingTerms.specificSpaces?.length > 0 && (
                          <span>Spaces: <span className="text-zinc-900">{order.stageBookingTerms.specificSpaces.join(', ')}</span></span>
                        )}
                        {order.stageBookingTerms.productionOfficeRental && (
                          <span className="text-amber-700">+ Production office</span>
                        )}
                        {order.stageBookingTerms.securityGuardRequired && (
                          <span className="text-amber-700">+ Security guard</span>
                        )}
                        {canSeeMoney && (
                          <span>Daily: <span className="font-mono text-zinc-900">{fmtMoney(order.stageBookingTerms.dailyRate)}</span></span>
                        )}
                      </div>
                      {hasStageNotes && order.stageBookingTerms.salesNotes && (
                        <div className="mt-1 text-[13px] text-zinc-800 whitespace-pre-wrap leading-relaxed">{order.stageBookingTerms.salesNotes}</div>
                      )}
                    </div>
                  )}
                  {dateOverrides.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-0.5">Off-window pickup / return</div>
                      <ul className="text-[13px] text-zinc-700 space-y-0.5">
                        {dateOverrides.map((li) => (
                          <li key={li.id} className="flex gap-2">
                            <span className="text-zinc-700 min-w-[1rem]">·</span>
                            <span className="flex-1">
                              <span className="text-zinc-900">{li.description}</span>
                              <span className="ml-2 text-zinc-700">
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
      {showSec('orders') && (
      <div id="orders" className="scroll-mt-4 bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Orders</h2>
          <span className="text-[12px] text-zinc-600">{job.orders.length} total</span>
        </div>
        {job.orders.length === 0 ? (
          <div className="text-[15px] text-zinc-700">No orders on this job yet.</div>
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
                <div key={o.id} className="bg-zinc-50 border border-zinc-200 rounded-lg">
                  <button
                    onClick={() => toggleOrder(o.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-100 transition-colors"
                  >
                    <span className="text-zinc-700 text-[13px] w-3">{expanded ? '▾' : '▸'}</span>
                    <span className="font-mono text-[15px] font-semibold text-zinc-900">{o.orderNumber}</span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${ORDER_STATUS_BADGE[o.status] || 'bg-zinc-100 text-zinc-700'}`}
                    >
                      {o.status}
                    </span>
                    {o.addedToJobAt && (
                      <span
                        title="Added later via inquiry triage"
                        className="text-[11px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider bg-zinc-100 text-zinc-700 border border-zinc-300"
                      >
                        Add-on
                      </span>
                    )}
                    <span className="text-[13px] text-zinc-700 whitespace-nowrap">
                      {fmtDay(o.startDate)} – {fmtDay(o.endDate)}
                    </span>
                    <span className="text-[11px] text-zinc-700 ml-2">
                      {o.lineItems.length} line{o.lineItems.length === 1 ? '' : 's'}
                    </span>
                    {canSeeMoney && (
                      <span className="ml-auto font-mono text-[13px] text-zinc-800">{fmtMoney(o.total)}</span>
                    )}
                    <Link
                      href={`/orders/${o.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="ml-2 shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-700 hover:bg-amber-100 hover:border-amber-400 transition-colors"
                    >
                      Open order →
                    </Link>
                  </button>

                  {/* The client rang / emailed to say yes. One click from
                      HERE, because this is the page the agent is on when
                      that happens — the order page's Mark Approved + Book
                      it were two clicks a screen away. */}
                  {MARK_BOOKABLE.has(o.status) && (
                    <div className="px-4 pb-2.5 -mt-1">
                      <MarkBookedButton orderId={o.id} orderNumber={o.orderNumber} orderStatus={o.status} onDone={load} />
                    </div>
                  )}

                  {expanded && (
                    <div className="border-t border-zinc-200 px-4 py-3 space-y-4">
                      {/* Booked scope */}
                      {o.lineItems.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1.5">Booked scope</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                              <thead className="text-[10px] uppercase tracking-wider text-zinc-600">
                                <tr className="border-b border-zinc-200">
                                  <th className="text-left pb-1.5 pr-2 font-semibold">Item</th>
                                  <th className="text-right pb-1.5 pr-2 font-semibold">Qty</th>
                                  <th className="text-right pb-1.5 pr-2 font-semibold">Days</th>
                                  {canSeeMoney && <th className="text-right pb-1.5 pr-2 font-semibold">Rate</th>}
                                  {canSeeMoney && <th className="text-right pb-1.5 pr-2 font-semibold">Total</th>}
                                  <th className="text-left pb-1.5 pl-2 font-semibold">Lane / Pick</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-200">
                                {o.lineItems.map((li) => (
                                  <tr key={li.id} className="text-zinc-700">
                                    <td className="py-1.5 pr-2">
                                      <div className="text-zinc-900">{li.description}</div>
                                      {li.qualifier && (
                                        <div className="text-[11px] text-zinc-700">{li.qualifier}</div>
                                      )}
                                    </td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{li.quantity}</td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{li.billableDays}</td>
                                    {canSeeMoney && <td className="py-1.5 pr-2 text-right font-mono">{fmtMoney(li.rate)}</td>}
                                    {canSeeMoney && <td className="py-1.5 pr-2 text-right font-mono">{fmtMoney(li.lineTotal)}</td>}
                                    <td className="py-1.5 pl-2 text-[11px]">
                                      {li.fulfillmentLane && (
                                        <span className="text-zinc-700 uppercase tracking-wider mr-2">{li.fulfillmentLane}</span>
                                      )}
                                      {li.pickStatus && (
                                        <span className="text-amber-700 uppercase tracking-wider">{li.pickStatus.replace(/_/g, ' ')}</span>
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
                          <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1.5">Per-vehicle assignments</div>
                          <ul className="text-[13px] text-zinc-700 space-y-0.5">
                            {orderBookings.flatMap((b) =>
                              b.items.flatMap((bi) =>
                                bi.assignments.map((a) => (
                                  <li key={a.id} className="flex gap-2">
                                    <span className="text-zinc-700 min-w-[1rem]">·</span>
                                    <span>
                                      <span className="text-zinc-900">{bi.category.name}</span>
                                      <span className="ml-2 font-mono text-amber-700">{a.asset.unitName}</span>
                                      <span className="ml-2 text-zinc-700">
                                        {fmtDay(a.startDate)} → {fmtDay(a.endDate)}
                                      </span>
                                      <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-600">{a.status.replace(/_/g, ' ')}</span>
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
                          <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1.5">Order agreements</div>
                          {/* One status line per contract — the full record
                              (dates, signer, PDFs) lives in the job-level
                              Agreement section this links to. */}
                          <ul className="text-[13px] text-zinc-700 space-y-0.5">
                            {o.signedAgreements.map((a) => {
                              const signed = a.status === 'SIGNED_BASELINE' || a.status === 'SIGNED_NEGOTIATED';
                              return (
                                <li key={a.id} className="flex items-baseline gap-2">
                                  <span className="text-zinc-600 min-w-[1rem]">·</span>
                                  <span className="text-zinc-900">{a.contractType.replace(/_/g, ' ')}</span>
                                  <span className={`text-[11px] uppercase tracking-wider ${signed ? 'text-emerald-700' : 'text-amber-700'}`}>
                                    {a.status.replace(/_/g, ' ')}
                                  </span>
                                  <a href="#agreement" className="text-[12px] text-zinc-600 hover:text-amber-600">
                                    View in Agreement section ↑
                                  </a>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Invoices */}
                      {canSeeMoney && o.invoices.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1.5">Invoices</div>
                          <ul className="text-[13px] text-zinc-700 space-y-0.5">
                            {o.invoices.map((inv) => (
                              <li key={inv.id} className="flex gap-2">
                                <span className="text-zinc-700 min-w-[1rem]">·</span>
                                <span className="flex-1">
                                  <span className="font-mono text-zinc-900">{inv.invoiceNumber}</span>
                                  <span className="ml-1.5 text-[10px] text-zinc-700 uppercase tracking-wider">{inv.type}</span>
                                  <span className="ml-2 text-[11px] uppercase tracking-wider text-amber-700">{inv.status}</span>
                                  <span className="ml-2 text-zinc-700">
                                    {fmtMoney(inv.amountPaid)} paid of {fmtMoney(inv.total)}
                                    {inv.balanceDue > 0 && (
                                      <span className="ml-1 text-amber-700"> · {fmtMoney(inv.balanceDue)} due</span>
                                    )}
                                  </span>
                                  {inv.dueDate && inv.status !== 'PAID' && (
                                    <span className="ml-2 text-[11px] text-zinc-700">due {fmtDay(inv.dueDate)}</span>
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
      )}

      {/* The HQ invoice, first in the money section — it is the document the
          client actually holds, and until now every action on it (view PDF,
          send, void, generate) lived one level down inside the order
          (Wes 2026-09-01). Everything below is RentalWorks-era or manual. */}
      {canSeeMoney && showSec('money') && (<>
      <div id="invoices" className="scroll-mt-4">
        <JobInvoicesPanel
          orders={job.orders.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            total: o.total,
            bookedTotal: o.bookedTotal,
            invoices: o.invoices,
          }))}
          onChanged={load}
        />
      </div>
      {/* RW billing: linked RW order → its invoices + balance. Anchored —
          the gantt's order badge / modal deep-link here for RW-linked jobs. */}
      <div id="rw-billing" className="scroll-mt-4">
        <JobRwBillingPanel jobId={job.id} />
      </div>
      {/* Sales -> collections handoff. Sits under RW billing because the
          agent is already looking at the job's RW invoices here. */}
      <JobFinalInvoicePanel jobId={job.id} openSignal={finalInvoiceOpen} />

      {/* RW quotes/invoices attached to this job (transitional). */}
      {/* Every vehicle's walk-around, both ends, staff and driver shots
          together (Wes 2026-09-08). Renders nothing when the job has no
          vehicles on it. */}
      <JobConditionPanel jobId={job.id} />

      <JobDocumentsPanel jobId={job.id} />
      </>)}

      {/* Contacts — Phase 7 Pass A: surface phone (already fetched,
          previously not rendered) so the agent can reach the client
          after-hours via a single tap. tel: link triggers native
          dialer on mobile / Mac Continuity Calling on desktop. */}
      {showSec('contacts') && (
      <div id="contacts" className="scroll-mt-4 bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Contacts</h2>
          <button
            onClick={() => { setAddingContact((v) => !v); setContactError(null); }}
            className="text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-100 transition-colors"
          >
            {addingContact ? 'Cancel' : '+ Add contact'}
          </button>
        </div>
        {job.jobContacts.length === 0 ? (
          <div className="text-[15px] text-zinc-700">No contacts yet.</div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {job.jobContacts.map((jc) => (
              <div key={jc.id} className="flex items-center justify-between py-2.5 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-8 h-8 shrink-0 rounded-full bg-amber-50 border border-amber-300 flex items-center justify-center text-[12px] font-bold text-amber-700"
                    style={{ fontFamily: 'Georgia, serif' }}
                  >
                    {((jc.person.firstName?.[0] ?? '') + (jc.person.lastName?.[0] ?? '')).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                  <div className="text-[15px] text-zinc-900 truncate">
                    {jc.person.firstName} {jc.person.lastName}
                    {jc.isPrimary && (
                      <span className="ml-2 text-[11px] font-bold text-amber-700 uppercase">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] text-zinc-700 truncate flex items-center gap-3 flex-wrap">
                    {/* An address that cannot receive mail is worse than
                        a missing one: it looks answered. SR-JOB-0268's
                        primary had the literal string "martinez" here and
                        rendered as a normal mailto. */}
                    {jc.person.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(jc.person.email) ? (
                      <a href={`mailto:${jc.person.email}`} className="hover:text-amber-600">
                        {jc.person.email}
                      </a>
                    ) : jc.person.email ? (
                      <span className="text-red-600" title="Not a valid email address — mail to this contact will not arrive">
                        {jc.person.email} · not a valid email
                      </span>
                    ) : (
                      <span className="text-zinc-600">no email</span>
                    )}
                    {jc.person.phone && (
                      <a
                        href={`tel:${jc.person.phone.replace(/[^\d+]/g, '')}`}
                        className="text-zinc-700 hover:text-amber-600 font-mono"
                      >
                        {jc.person.phone}
                      </a>
                    )}
                    {/* Last-minute changes go by text (Wes 2026-09-07). The
                        composer shows consent state before anyone types. */}
                    {jc.person.phone && (
                      <TextButton jobId={job.id} phone={jc.person.phone} name={`${jc.person.firstName} ${jc.person.lastName}`.trim()} />
                    )}
                  </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Wes 2026-08-31: a wrong primary was permanent, and
                      since 2026-08-18 the primary decides who gets the
                      payment-options email. Both actions live on the row
                      so fixing it is where you notice it. */}
                  {!jc.isPrimary && (
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch(`/api/jobs/${job.id}/contacts/${jc.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ isPrimary: true }),
                        });
                        load();
                      }}
                      className="text-[11px] font-semibold text-zinc-600 hover:text-amber-600"
                      title="Route this job's client mail to this contact"
                    >
                      Make primary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      const who = `${jc.person.firstName} ${jc.person.lastName}`.trim() || jc.person.email || 'this contact';
                      // Names the consequence precisely: the CRM record
                      // survives, only the link to this job goes.
                      if (!confirm(`Remove ${who} from ${job.jobCode}?\n\nTheir contact record stays in the CRM — this only unlinks them from this job.`)) return;
                      await fetch(`/api/jobs/${job.id}/contacts/${jc.id}`, { method: 'DELETE' });
                      load();
                    }}
                    className="text-[11px] font-semibold text-zinc-600 hover:text-red-600"
                    title="Unlink from this job (keeps the CRM record)"
                  >
                    Remove
                  </button>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700 bg-zinc-100 px-2 py-1 rounded">
                    {jc.role}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {addingContact && (
          <div className="mt-3 pt-3 border-t border-zinc-200 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                value={contactForm.email}
                onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Email *"
                type="email"
                className="sm:col-span-2 bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-amber-600"
              />
              <input
                value={contactForm.firstName}
                onChange={(e) => setContactForm((f) => ({ ...f, firstName: e.target.value }))}
                placeholder="First name"
                className="bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-amber-600"
              />
              <input
                value={contactForm.lastName}
                onChange={(e) => setContactForm((f) => ({ ...f, lastName: e.target.value }))}
                placeholder="Last name"
                className="bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-amber-600"
              />
            </div>
            <select
              value={contactForm.role}
              onChange={(e) => setContactForm((f) => ({ ...f, role: e.target.value }))}
              className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none focus:border-amber-600"
            >
              <option value="PRODUCER">Producer</option>
              <option value="PM">Production Manager</option>
              <option value="PC">Production Coordinator</option>
              <option value="TRANSPO">Transpo</option>
              <option value="ACCOUNTING">Accounting</option>
              <option value="ART_DEPT">Art Dept</option>
              <option value="OTHER">Other</option>
            </select>
            {/* The role is routing, not just a label — say so where it is picked. */}
            <p className="text-[11px] text-zinc-600">
              Accounting receives payment emails (final invoices, payment options).
              Without one, they go to the primary contact.
            </p>
            {contactError && <p className="text-[12px] text-red-600">{contactError}</p>}
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
      )}

      {/* Client notes — READ-ONLY here. Idiosyncrasies & preferences for
          this client, so staff know how they like to work. Authored on
          the client file (Company.notes); this is just the at-a-glance. */}
      {showSec('clientNotes') && (
      <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 transition-colors duration-200 hover:border-zinc-400">
        <div className="flex items-start gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold text-zinc-900 shrink-0 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
            Client notes
          </h2>
          {job.company.notes?.trim() ? (
            <div className="flex-1 min-w-[240px] text-[14px] text-zinc-800 whitespace-pre-wrap leading-relaxed">
              {job.company.notes}
            </div>
          ) : (
            <div className="flex-1 min-w-[240px] text-[13px] text-zinc-600 italic">
              No preferences or quirks recorded for {job.company.name} yet.
            </div>
          )}
          <Link
            href={`/crm/${job.company.id}`}
            className="shrink-0 text-[12px] font-semibold text-amber-700 hover:text-amber-700"
          >
            Edit on client file →
          </Link>
        </div>
      </div>
      )}

      {/* Job notes — THIS job only */}
      <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
            Job notes
            {/* Wes wrote crew instructions here and expected them on the
                client's quote. They are internal and always were; the
                quote prints the ORDER's notes. Saying so on both fields
                is cheaper than the round trip. */}
            <span className="text-[11px] font-medium text-zinc-600">internal — not on client documents</span>
          </h2>
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
          placeholder="Internal notes for this job — logistics, deal specifics. For text the client should see on the quote, use Notes on the order."
          className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-[15px] text-zinc-900 focus:outline-none focus:border-zinc-400 resize-y"
        />
      </div>

      {/* Email threads filed in this Job (email-in-Job, step 6). The
          component hides itself until a thread is filed. */}
      <JobEmailThreads jobId={job.id} tone="light" />

      {/* Not started — every empty section, reachable in one click.
          A chip expands its section in place; a section that gains
          content leaves this strip on the next load automatically. */}
      {foldedChips.length > 0 && (
        <div className="bg-gradient-to-b from-white to-zinc-50 border border-dashed border-zinc-300 rounded-2xl px-4 py-3.5">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-600 mb-2">
            Not started — opens in place, appears automatically once it has content
          </div>
          <div className="flex flex-wrap gap-1.5">
            {foldedChips.map((m) => (
              <button
                key={m.key}
                onClick={() => openSection(m.key, m.anchor)}
                className="text-[11.5px] text-zinc-600 bg-zinc-50 border border-zinc-300 rounded-md px-2.5 py-1 hover:border-amber-400 hover:text-amber-600 transition-colors"
              >
                {m.label} <span className="text-zinc-600">+</span>
              </button>
            ))}
          </div>
        </div>
      )}


      {/* Activity — Phase 7 Pass B. AuditLog feed scoped to this job
          and everything rooted on its orders (invoices, picklists,
          payments). Newest first. Each row formats with who/what/when;
          for UPDATE actions we surface the changed fields' before→after
          when oldValues + newValues both have ≤3 entries (otherwise
          fall back to a generic "updated" line). */}
      {job.activity.length > 0 && (
        <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Activity</h2>
            <span className="text-[13px] text-zinc-700">{job.activity.length} event{job.activity.length === 1 ? '' : 's'}</span>
          </div>
          <ul className="space-y-1.5">
            {job.activity.map((a) => {
              const formatted = formatActivity(a);
              return (
                <li key={a.id} className="flex gap-3 text-[13px] text-zinc-700 border-l border-zinc-200 pl-3 py-0.5">
                  <span className="text-zinc-700 whitespace-nowrap min-w-[60px]" title={new Date(a.createdAt).toLocaleString()}>
                    {relativeAge(a.createdAt)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-zinc-900">{a.user?.name || 'System'}</span>
                    <span className="text-zinc-700"> {formatted.verb} </span>
                    <span className="text-zinc-900">{formatted.what}</span>
                    {formatted.details && (
                      <span className="text-zinc-700"> · {formatted.details}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {markLostOpen && (
        <MarkLostModal
          job={{
            id: job.id,
            name: job.name,
            jobCode: job.jobCode,
            company: { name: job.company?.name ?? '' },
          }}
          onClose={() => setMarkLostOpen(false)}
          onMarked={() => { setMarkLostOpen(false); load(); }}
        />
      )}

      {releaseOpen && (
        <MarkLostModal
          mode="release"
          job={{
            id: job.id,
            name: job.name,
            jobCode: job.jobCode,
            company: { name: job.company?.name ?? '' },
          }}
          onClose={() => setReleaseOpen(false)}
          onMarked={() => { setReleaseOpen(false); load(); }}
        />
      )}

      {reviewCoiId && (
        <CoiReviewModal
          coiId={reviewCoiId}
          onClose={() => setReviewCoiId(null)}
          onChanged={load}
          // Approving closes the modal, so the outcome — including whether
          // the client's note actually sent — has to land out here or it is
          // lost with the modal.
          onDecided={(msg) => flashToast(msg)}
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

      <EmailReviewModal
        target={emailTarget}
        onClose={() => setEmailTarget(null)}
        onSent={(info) => {
          // Two kinds share this modal — the toast has to say which went out.
          const what =
            emailTarget?.kind === 'paperwork-summary' ? 'Paperwork summary' : 'Card request';
          setEmailTarget(null);
          flashToast(`${what} sent to ${info.recipient}`);
          load();
        }}
      />

      {redlineOrder && (
        <EnterRedlineModal
          orderId={redlineOrder.id}
          jobName={job.name}
          onClose={() => setRedlineOrder(null)}
          onSaved={(result) => {
            setRedlineOrder(null);
            router.push(`/tools/contract-review/${result.reviewId}`);
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

function Meta({ label, value, sub, dim }: { label: string; value: string; sub?: string; dim?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">{label}</div>
      <div className={`mt-0.5 truncate ${dim ? 'text-[13px] text-zinc-600' : 'text-[15px] text-zinc-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-600">{sub}</div>}
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
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-zinc-200 bg-zinc-100 text-zinc-700';
  return (
    <div className={`flex items-baseline gap-1.5 px-2.5 py-1 rounded-md border ${toneClass}`}>
      <span className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</span>
      <span className="text-[13px] font-semibold">{value}</span>
      {sub && <span className="text-[11px] opacity-70">{sub}</span>}
    </div>
  );
}
