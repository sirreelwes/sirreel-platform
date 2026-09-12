'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { quoteLcdw, LCDW_FEE_CODE } from '@/lib/pricing/lcdwEligibility';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { LineItemDepartment, ProductionType, RateType } from '@prisma/client';
import { OrderCreateGuard } from '@/components/shared/OrderCreateGuard';
import { JobPicker, EMPTY_JOB_PICKER_VALUE, type JobPickerValue } from '@/components/shared/JobPicker';
import { JobResolverModal } from '@/components/shared/JobResolverModal';
import { EmailReviewModal, type EmailReviewTarget } from '@/components/email/EmailReviewModal';
import { InquirySourceDrawer } from '@/components/inquiries/InquirySourceDrawer';
import { needsJobDisambiguation } from '@/lib/jobs/jobDisambiguation';
// selectedClientId is usually a Company id but is sometimes an ANSWER
// ('__new__' / '__unknown__'). Anything wanting a real id asks through
// realCompanyId — see the module for why that is not spelled inline.
import {
  COMPANY_SENTINEL_NEW, COMPANY_SENTINEL_UNKNOWN, isUnknownCompany, realCompanyId,
} from '@/lib/companies/pickerSentinels';
import { CompanyPicker, EMPTY_COMPANY_PICKER_VALUE, type CompanyPickerValue } from '@/components/shared/CompanyPicker';
import { LineItemRowActions } from '@/components/lineItems/LineItemRowActions';
import { LineItemUndoToast, type LineItemUndoToastState } from '@/components/lineItems/LineItemUndoToast';
import { LineItemDescriptionCombobox } from '@/components/orders/LineItemDescriptionCombobox';
import { AddItemModal, type CreatedInventoryItem } from '@/components/inventory/AddItemModal';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { IntegerInput } from '@/components/ui/IntegerInput';
import { deriveProfileIdFromProductionType } from '@/lib/sales/productionTypeProfile';

const PRODUCTION_TYPES: ProductionType[] = [
  'FILM', 'TV', 'COMMERCIAL', 'MUSIC_VIDEO', 'CORPORATE', 'EVENT_PLANNER', 'OTHER',
];
const PRODUCTION_TYPE_LABEL: Record<ProductionType, string> = {
  FILM: 'Film',
  TV: 'TV',
  COMMERCIAL: 'Commercial',
  MUSIC_VIDEO: 'Music Video',
  CORPORATE: 'Corporate',
  EVENT_PLANNER: 'Event Planner',
  OTHER: 'Other',
};
import { DEPARTMENT_LABEL, DEPARTMENT_SHORT } from '@/lib/sales/pipeline';
import {
  availableRateTypes,
  BILLING_RULES,
  billingBreakdown,
  calendarDays,
  computeBillableDays,
  computeLineTotal,
  defaultRateType,
  defaultWeekCap,
  weekCapChoices,
} from '@/lib/orders/billing';
import {
  weekCapExempt,
  weekDecisionsPending,
  weekSection,
  type WeekLine,
  type WeekSection,
} from '@/lib/orders/weekDecision';
import { WeekDecisionPrompt } from '@/components/orders/WeekDecisionPrompt';

/** What each create action is called, for the prompt's primary button —
 *  the agent pressed one of these and should be handed it back, not a
 *  generic "Continue". */
const CREATE_ACTION_LABEL: Record<'draft' | 'preview' | 'download' | 'send', string> = {
  draft: 'Save draft',
  preview: 'Preview PDF',
  download: 'Download PDF',
  send: 'Send quote',
};

const DEPARTMENTS: LineItemDepartment[] = [
  'VEHICLES', 'COMMUNICATIONS', 'STAGES', 'GE', 'EXPENDABLES', 'PRO_SUPPLIES', 'ART',
  'WARDROBE_MAKEUP',
  'PHOTO_SHOOT',
];

type CatalogType = 'INVENTORY' | 'ASSET_CATEGORY' | 'PACKAGE';

interface ResolvedItem {
  /** Stable client-side identifier minted whenever a row enters the
   *  items array (parse, manual add, package expansion, draft restore).
   *  Drives the React key and every mutate-by-id handler so deletes,
   *  inserts, and reorders never trip React reconciliation. Not
   *  persisted — stripped at save time. */
  localId: string;
  description: string;
  quantity: number;
  catalogProductId: string | null;
  catalogType: CatalogType | null;
  department: LineItemDepartment;
  qualifier: string | null;
  rateType: RateType;
  pickupDate: string;  // ISO YYYY-MM-DD — empty string = TBD
  returnDate: string;  // ISO YYYY-MM-DD — empty string = TBD
  /** NULL = dates TBD; the line is a rate-card price-per-day until
   *  the rep commits dates. Math returns 0 in this state; UI renders
   *  "$X/day · total on dates" instead of a fake 1-day total.
   *  See computeLineTotal() in src/lib/orders/billing.ts. */
  billableDays: number | null;
  /** Client shoot-days CLAIM from the public order form (cart
   *  conversion) — a REQUEST persisted on the line as PENDING; never
   *  prices anything until the agent confirms. */
  claimedDays?: number | null;
  rate: number;
  matchedProduct: { id: string; type: CatalogType; name: string } | null;
  matchSource: 'AI' | 'ALIAS_FALLBACK' | 'AUTO_KIT' | null;
  warnings: string[];
  // Transient UI-only flag set when an auto-reset fires so we can show
  // the inline note. Cleared on the next user-initiated edit.
  rateTypeAutoResetNote?: string | null;
  // Package grouping. When a Package is picked from the combobox,
  // one header line + N member lines share a packageInstanceId
  // (minted client-side at pick-time, persisted on save). The
  // header carries the package's pricePerDay; member lines render
  // with rate=0 and "included" on the invoice PDF. packageId points
  // back at the template for analytics.
  packageInstanceId?: string | null;
  packageId?: string | null;
  isPackageHeader?: boolean;
  isPackageMember?: boolean;
  // Set on the header when members have been added / removed / qty-
  // edited relative to the template — surfaces an amber dot + tooltip
  // ("Package contents modified — verify pricing"). Pricing math is
  // unchanged; this is a soft warning for the rep.
  isPackageModified?: boolean;
}

/** A builder row, as the billing-week arithmetic needs it. One adapter so
 *  the section select, the pre-send prompt and the section-wide apply all
 *  ask the same question of the same fields. */
function weekLine(it: ResolvedItem): WeekLine {
  return {
    department: it.department,
    quantity: it.quantity,
    rate: it.rate,
    rateType: it.rateType,
    billableDays: it.billableDays,
    pickupDate: it.pickupDate,
    returnDate: it.returnDate,
    catalogProductId: it.catalogProductId,
    description: it.description,
  };
}

interface ParsedTop {
  clientName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  productionName?: string;
  startDate?: string;
  endDate?: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  notes?: string;
}

interface ClientCandidate {
  id: string;
  name: string;
  tier: string;
  coiOnFile: boolean;
  defaultAgentId: string | null;
}

// What we get back from /api/orders/parse-quote per contact. Mirrors
// ResolvedContact in the route. Locally re-typed (don't cross-import
// API types) plus a UI-only `include` flag — defaults are set by
// confidence: high+medium pre-checked, low pre-unchecked so body
// mentions don't silently land in the CRM.
type ContactSource = 'header' | 'signature' | 'body_mention';
type ContactConfidence = 'high' | 'medium' | 'low';
type ContactMatchStatus = 'existing' | 'new' | 'possible_match';
type SuggestedJobRole = 'PRODUCER' | 'PM' | 'PC' | 'TRANSPO' | 'ACCOUNTING' | 'ART_DEPT' | 'OTHER';
const JOB_ROLES: SuggestedJobRole[] = ['PRODUCER', 'PM', 'PC', 'TRANSPO', 'ACCOUNTING', 'ART_DEPT', 'OTHER'];

interface ResolvedContact {
  name: string;
  email: string;
  title: string | null;
  phone: string | null;
  company: string | null;
  suggested_role: SuggestedJobRole | null;
  source: ContactSource;
  confidence: ContactConfidence;
  match_status: ContactMatchStatus;
  existing_person_id: string | null;
  candidate_person_id: string | null;
  // UI state (not from API)
  include: boolean;
  role: SuggestedJobRole; // role to associate against the job; defaults to suggested_role || OTHER
  decision?: 'merge' | 'create_new'; // possible_match resolution
}

interface AttachableJob {
  id: string;
  jobCode: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  company: { id: string; name: string };
  agent: { id: string; name: string };
  // Surfaces from GET /api/jobs — used by the post-parse Job picker to
  // describe each candidate ("3 existing orders, $14,200 booked").
  _count?: { orders: number };
  orderTotal?: number;
}

// Post-parse Job decision uses the shared JobPicker (same component
// as the +Hold modal): searching → selected_existing | creating_new.
// Save is gated on a definite choice — no implicit "new" default,
// which prevents accidental duplicate Jobs when matching candidates
// are sitting right there.

interface InquiryRecord {
  id: string;
  title: string;
  description: string;
  source?: 'MANUAL' | 'GMAIL' | 'WEB_FORM';
  estimatedValue: number | null;
  preferredStartDate: string | null;
  preferredEndDate: string | null;
  company: { id: string; name: string } | null;
  person: { id: string; firstName: string; lastName: string; email: string } | null;
  status: 'NEW' | 'CONVERTED' | 'DISMISSED';
  sourceMetadata?: SupplyOrderInquiryMetadata | null;
}

// Shape of sourceMetadata when the inquiry came from /order/supplies
// (Phase 3 hardened public endpoint). When `kind === 'supply-order'`
// we skip the email-parse step and seed items + contact straight
// from the cart snapshot.
interface SupplyOrderInquiryMetadata {
  kind?: string;
  reference?: string;
  contact?: { name?: string | null; email?: string | null; phone?: string | null; role?: string | null };
  production?: { companyName?: string | null; jobName?: string | null; poNumber?: string | null; jobNumber?: string | null };
  dates?: { start?: string | null; end?: string | null; rentalDays?: number | null };
  // Real snapshot stores the window here (the form writes `window`, not `dates`).
  window?: { start?: string | null; end?: string | null; days?: number | null };
  delivery?: { method?: string | null; address?: string | null };
  cart?: {
    itemKind?: 'SUPPLY' | 'VEHICLE';
    itemId: string;
    code: string;
    name: string;
    type: string;
    category: string;
    unitPrice: number;
    // Real snapshot uses `qty`; `quantity` kept optional for forward-compat.
    qty?: number;
    quantity?: number;
    days: number | null;
    /** Client shoot-days CLAIM captured by the public form. */
    claimedDays?: number | null;
    pickupDate?: string;
    returnDate?: string;
    lineTotal: number;
    // Added by /api/inquiries/[id] enrichment (not stored in the raw snapshot).
    assetCategoryId?: string | null;
    department?: string | null;
  }[];
  totals?: { units?: number; amount?: number };
  notes?: string | null;
}

interface CatalogSearchResult {
  id: string;
  type: CatalogType;
  name: string;
  department: LineItemDepartment;
  dailyRate: number;
  weeklyRate: number;
  // PACKAGE only — the member items the parent expands into rows.
  items?: {
    inventoryItemId: string;
    name: string;
    code: string;
    qty: number;
    dailyRate: number;
    weeklyRate: number;
    department: LineItemDepartment;
  }[];
}

// pickRate is used when applying a catalog match to seed the line's rate.
// Most InventoryItems only have weeklyRate populated, so derive the missing
// side using a 5-day work-week assumption.
function pickRate(p: { dailyRate: number; weeklyRate: number }, rt: RateType): number {
  if (rt === 'WEEKLY' || rt === 'MONTHLY') return p.weeklyRate > 0 ? p.weeklyRate : p.dailyRate * 5;
  return p.dailyRate > 0 ? p.dailyRate : p.weeklyRate / 5;
}

const DEPT_BADGE: Record<LineItemDepartment, string> = {
  VEHICLES:       'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30',
  COMMUNICATIONS: 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30',
  STAGES:         'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30',
  GE:             'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30',
  EXPENDABLES:    'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30',
  PRO_SUPPLIES:   'bg-lt-inner text-lt-fg2 border-lt-hairline',
  ART:            'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30',
  WARDROBE_MAKEUP:'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30',
  PHOTO_SHOOT:    'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30',
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

/**
 * A discount the rep sets up BEFORE the order exists.
 *
 * Mirrors OrderDiscount exactly (scope + departmentKey + type + value) so the
 * draft rows POST straight through after the order is created, and the saved
 * order's DiscountsPanel shows precisely what the draft previewed. Percent is
 * the reason this exists: the draft form only ever offered one order-wide
 * DOLLAR discount, so "10% off vehicles" had to be done after saving, by hand,
 * on another screen.
 */
interface DraftDiscount {
  localId: string;
  scope: 'ORDER' | 'DEPARTMENT';
  departmentKey: LineItemDepartment | null;
  type: 'PERCENT' | 'FIXED';
  /** PERCENT: 0-100. FIXED: a positive dollar amount (sign is applied here). */
  value: number;
  label: string;
}

const RATE_TYPE_LABEL: Record<RateType, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  FLAT: 'Purchase',
};
function rateTypeLabel(rt: RateType): string {
  return RATE_TYPE_LABEL[rt];
}

// Stable per-row id. crypto.randomUUID when available; otherwise a
// time+random fallback that's good enough for in-session uniqueness.
function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `li-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Tag every incoming row with a localId. Parse-API output and
// supply-order cart conversions both flow through here so parsed rows
// behave identically to manually-added ones.
type IncomingItem = Omit<ResolvedItem, 'localId'> & { localId?: string };
function withLocalIds(items: IncomingItem[]): ResolvedItem[] {
  return items.map((it) => ({ ...it, localId: it.localId ?? newLocalId() }));
}


export default function NewQuotePage() {
  return (
    // Sales writes the orders (Hugo, 2026-09-03). The guard is cosmetic —
    // POST /api/orders enforces the same rule — but without it the yard
    // crew could fill the whole builder in and only be refused on save.
    <OrderCreateGuard>
      <Suspense fallback={<div className="p-6 text-sm text-lt-fg2">Loading…</div>}>
        <NewQuotePageInner />
      </Suspense>
    </OrderCreateGuard>
  );
}

function NewQuotePageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { data: session } = useSession();
  const inquiryId = search.get('inquiryId');
  // Round-trip from /crm?selectForQuote=1 — when the user picks a
  // company over there, they're sent back here with this param set.
  const clientCompanyIdFromUrl = search.get('clientCompanyId');
  // Deep-link from the Job detail "+ New quote" action (canonical-Job
  // consolidation) — the Job decision arrives already made.
  const jobIdFromUrl = search.get('jobId');
  // Deep-link from a RESERVATION (Wes 2026-09-10: "when we open a
  // reservation we should be able to add a warehouse order there, which
  // will open the order fill-out and assign it to be loaded on that
  // vehicle"). The order is written normally; once it exists it is
  // attached to this unit (BookingAssignment.orderId — the yard's
  // "Order attached" indicator) so the warehouse knows which truck it
  // goes out on.
  const loadOnAssignmentId = search.get('loadOnAssignmentId');
  // "Both" from the New Order / Rez chooser (Wes 2026-09-12): open in
  // the builder with the Reservation section ready instead of on the
  // paste/upload step. Nothing is held until save — the hold and the
  // unit fall out of the vehicle lines, ORDER-FIRST, the same way they
  // do for every quoted vehicle (see MakeReservationModal's header for
  // why hold-first double-books).
  const reserveFromUrl = search.get('reserve') === '1';
  const [builderForced, setBuilderForced] = useState(reserveFromUrl);
  const [loadOn, setLoadOn] = useState<{
    id: string;
    unit: { id: string; unitName: string };
    category: { id: string; name: string } | null;
    booking: { id: string; bookingNumber: string };
    startDate: string;
    endDate: string;
    job: { id: string; jobCode: string; name: string; company: { id: string; name: string } | null } | null;
    order: { id: string; orderNumber: string } | null;
  } | null>(null);
  const [loadOnError, setLoadOnError] = useState<string | null>(null);
  useEffect(() => {
    if (!loadOnAssignmentId) return;
    fetch(`/api/scheduling/assignments/${loadOnAssignmentId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.assignment) setLoadOn(d.assignment);
        else setLoadOnError(d?.error || 'That reservation could not be read.');
      })
      .catch(() => setLoadOnError('That reservation could not be read.'));
  }, [loadOnAssignmentId]);
  // The reservation's dates are the order's dates unless the parse says
  // otherwise — a warehouse order goes out and comes back with the truck.
  useEffect(() => {
    if (!loadOn) return;
    setEditing((prev) => ({
      ...prev,
      startDate: prev.startDate || loadOn.startDate,
      endDate: prev.endDate || loadOn.endDate,
    }));
  }, [loadOn]);

  // Job decision is deferred until AFTER AI parse — see candidateJobs
  // fetch + JobPicker render below. Default mode is `searching` so
  // save stays blocked until the user explicitly picks an existing
  // Job or commits to creating a new one.
  const [job, setJob] = useState<JobPickerValue>(EMPTY_JOB_PICKER_VALUE);

  // ?jobId= prefill — one-shot, and never clobbers a user pick or a
  // restored draft that already carries a Job (the setter's guard
  // checks mode/jobId at apply time, not fetch time).
  const jobPrefillFired = useRef(false);
  useEffect(() => {
    if (!jobIdFromUrl || jobPrefillFired.current) return;
    jobPrefillFired.current = true;
    fetch(`/api/jobs/${jobIdFromUrl}`)
      .then((r) => r.json())
      .then((d) => {
        const j = d?.job;
        if (!j?.id) return;
        setJob((prev) =>
          prev.mode !== 'searching' || prev.jobId
            ? prev
            : {
                jobId: j.id,
                jobCode: j.jobCode,
                name: j.name,
                mode: 'selected_existing',
                company: j.company ? { id: j.company.id, name: j.company.name } : null,
              },
        );
      })
      .catch(() => {});
  }, [jobIdFromUrl]);
  const [candidateJobs, setCandidateJobs] = useState<AttachableJob[]>([]);

  const [inquiry, setInquiry] = useState<InquiryRecord | null>(null);
  // "View original" opens the source email OVER the form. It used to be a
  // link to /inquiries/[id]: on the Review step that navigation threw away
  // every un-saved edit on the page.
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);

  const [inputMode, setInputMode] = useState<'paste' | 'pdf'>('paste');
  // Server detail for a failed PDF parse — rendered as an inline banner
  // with one-click fallbacks (Paste Email / manual entry), not an alert().
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [emailText, setEmailText] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfDragOver, setPdfDragOver] = useState(false);
  // Inline rejection for non-PDF drops/picks — the parse endpoint only
  // accepts application/pdf (it hardcodes the media_type).
  const [pdfTypeError, setPdfTypeError] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const acceptPdfFile = useCallback((file: File | null | undefined) => {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setPdfTypeError(`"${file.name}" isn't a PDF — the parser only accepts PDF files.`);
      return;
    }
    setPdfTypeError(null);
    setPdfError(null);
    setPdfFile(file);
  }, []);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedTop | null>(null);

  // Cmd+V a copied PDF anywhere on the page while the Upload PDF tab is
  // active — same handler as drop/pick. Text pastes (no files) fall
  // through untouched so the Paste Email tab is unaffected.
  useEffect(() => {
    if (inputMode !== 'pdf' || parsed) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files?.[0];
      if (file) acceptPdfFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [inputMode, parsed, acceptPdfFile]);
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [undoToast, setUndoToast] = useState<LineItemUndoToastState | null>(null);
  const [editing, setEditing] = useState<ParsedTop>({});
  const [clientCandidates, setClientCandidates] = useState<ClientCandidate[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  // Type-ahead Company picker (STEP 1B). Coexists with the legacy
  // selectedClientId string for now — the picker is the rep-facing
  // input, selectedClientId is what the save/jobs-fetch flow reads.
  // A sync effect below keeps them aligned.
  const [companyPick, setCompanyPick] = useState<CompanyPickerValue>(EMPTY_COMPANY_PICKER_VALUE);
  const [contacts, setContacts] = useState<ResolvedContact[]>([]);

  // (Hoisted before the history-fetch effect + leadContact memo so
  // they can read it without TDZ.)
  // confirmedLeadPersonId is the rep's explicit decision when the
  // automatic detection isn't enough — either confirming a
  // possible_match or overriding to a different person.
  const [confirmedLeadPersonIdEarly, setConfirmedLeadPersonIdEarly] = useState<string | null>(null);
  const confirmedLeadPersonId = confirmedLeadPersonIdEarly;
  const setConfirmedLeadPersonId = setConfirmedLeadPersonIdEarly;

  // CompanyPicker → selectedClientId sync (STEP 1B). The picker's
  // four modes map cleanly:
  //   selected_existing  → selectedClientId = companyId
  //   creating_new       → selectedClientId = '__new__'
  //   unknown            → selectedClientId = '__unknown__'
  //   searching          → selectedClientId = ''
  //
  // '__unknown__' is a real answer, not an empty one — that is the whole
  // point of it. It unblocks the save (a company we do not have yet must
  // not hold a quote hostage) and the resolver turns it into a per-job
  // provisional placeholder. Both sentinels are filtered out of every
  // place that expects a genuine company id; see NOT_A_COMPANY_ID.
  useEffect(() => {
    if (companyPick.mode === 'selected_existing' && companyPick.companyId) {
      setSelectedClientId(companyPick.companyId);
    } else if (companyPick.mode === 'creating_new') {
      setSelectedClientId(COMPANY_SENTINEL_NEW);
    } else if (companyPick.mode === 'unknown') {
      setSelectedClientId(COMPANY_SENTINEL_UNKNOWN);
    } else {
      setSelectedClientId('');
    }
  }, [companyPick]);

  // Seed the picker from extracted state — when AI extracted a name
  // and we have fuzzy hits, default the picker to the first hit.
  // When there are no hits but the AI extracted a name, the rep can
  // still type or use the lead's affiliations.
  useEffect(() => {
    if (companyPick.mode !== 'searching') return;
    if (clientCandidates.length === 1 && selectedClientId === clientCandidates[0].id) {
      // The legacy auto-select already set selectedClientId; reflect
      // it into the picker so the green pill renders.
      const m = clientCandidates[0];
      setCompanyPick({
        companyId: m.id, name: m.name, mode: 'selected_existing',
        tier: m.tier, coiOnFile: m.coiOnFile,
      });
    }
  }, [clientCandidates, selectedClientId, companyPick.mode]);

  // History fetch — only fires for an `existing` anchored lead. A
  // `possible_match` doesn't pre-fetch (would be wrong if the rep
  // overrides). When the rep confirms a possible_match, this re-runs
  // with the now-existing id.
  useEffect(() => {
    // Compute the eligible person id inside the effect so the deps
    // can stay minimal (contacts + confirmedLeadPersonId only).
    let personId: string | null = null;
    if (confirmedLeadPersonId) {
      personId = confirmedLeadPersonId;
    } else {
      const ex = contacts.find((c) => c.match_status === 'existing' && c.existing_person_id);
      if (ex) personId = ex.existing_person_id;
    }
    if (!personId) { setLeadPersonHistory(null); return; }
    let cancelled = false;
    setLeadHistoryLoading(true);
    fetch(`/api/crm/people/${personId}/history`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) setLeadPersonHistory(data as PersonHistory);
      })
      .finally(() => { if (!cancelled) setLeadHistoryLoading(false); })
    return () => { cancelled = true; };
  }, [contacts, confirmedLeadPersonId]);

  // Lead-person detection — derived from the parsed contacts payload.
  // Returns the strongest signal:
  //   1. confirmed = the rep explicitly picked someone (overrides automatic anchor)
  //   2. existing  = highest-confidence match found via resolvePersonByEmail
  //   3. possible_match = surface as "Is this X?", does NOT auto-anchor
  //   4. new = falls through to the existing PeopleSection quick-add path
  // possible_match only becomes the lead AFTER explicit confirm.
  const leadContact = useMemo(() => {
    if (contacts.length === 0) return null;
    const confirmed = confirmedLeadPersonId
      ? contacts.find((c) => c.existing_person_id === confirmedLeadPersonId || c.candidate_person_id === confirmedLeadPersonId)
      : null;
    if (confirmed) return { contact: confirmed, status: 'existing' as const };
    const existing = contacts.find((c) => c.match_status === 'existing' && c.existing_person_id);
    if (existing) return { contact: existing, status: 'existing' as const };
    const possible = contacts.find((c) => c.match_status === 'possible_match' && c.candidate_person_id);
    if (possible) return { contact: possible, status: 'possible_match' as const };
    const fresh = contacts.find((c) => c.match_status === 'new' && c.email);
    if (fresh) return { contact: fresh, status: 'new' as const };
    return null;
  }, [contacts, confirmedLeadPersonId]);

  const [creating, setCreating] = useState(false);
  const [discounts, setDiscounts] = useState<DraftDiscount[]>([]);

  // Person-first anchor (STEP 1A) — leads the Review Quote when the
  // AI-extracted contacts include an `existing` match. Possible_match
  // is surfaced as "Is this X?" without auto-binding (sender could be
  // an assistant or a shared address). `new` falls through to the
  // existing PeopleSection quick-add. Live history pulled via
  // /api/crm/people/[id]/history — uses _count(), NOT the stale
  // denorms on Person.
  interface PersonHistory {
    person: {
      id: string;
      name: string;
      email: string;
      role: string;
      rawTitle: string | null;
      lastKnownProject: string | null;
      counts: { priorOrders: number; jobContacts: number; bookings: number; referredBookings: number };
    };
    recentOrders: { id: string; orderNumber: string; companyName: string | null; jobName: string | null; createdAt: string }[];
    suggestedCompanies: { id: string; name: string; tier: string; reason: string }[];
  }
  const [leadPersonHistory, setLeadPersonHistory] = useState<PersonHistory | null>(null);
  const [leadHistoryLoading, setLeadHistoryLoading] = useState(false);
  // confirmedLeadPersonId — see the early-hoisted declaration above.

  // Explicit "+ Create new Job" fields. The pre-Phase-5 flow inferred
  // these silently — productionType defaulted to OTHER, notes were a
  // canned "Auto-created from quote parser" string. Now exposed in
  // the picker so the agent decides; prefilled but editable.
  const [newJobProductionType, setNewJobProductionType] = useState<ProductionType>('OTHER');
  const [newJobNotes, setNewJobNotes] = useState('');
  // Picker for the new ProductionTypeProfile lookup (drives the
  // fleet-assignment optimizer later). Coexists with the legacy
  // productionType enum above; both fields submit independently on
  // the new-Job create body.
  const [newJobProductionTypeProfileId, setNewJobProductionTypeProfileId] =
    useState<string | null>(null);

  // One-time profile slug→id map. Used by the auto-derive effect
  // below to translate the agent's production type into the right
  // ProductionTypeProfile id without surfacing a routing dropdown.
  const [profileSlugToId, setProfileSlugToId] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetch('/api/production-type-profiles', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const p of (d.profiles ?? []) as { id: string; slug: string }[]) {
          map[p.slug] = p.id;
        }
        setProfileSlugToId(map);
      })
      .catch(() => {
        if (!cancelled) setProfileSlugToId({});
      });
    return () => { cancelled = true; };
  }, []);

  // Auto-derive the ProductionTypeProfile id from the chosen
  // production type. The tier (1–5) lives on the resolved profile
  // and is INFORMATIVE TO THE HQ AI ROUTING ONLY — agents never pick
  // it. Re-runs when the production type changes or when the profile
  // map first arrives.
  useEffect(() => {
    const next = deriveProfileIdFromProductionType(newJobProductionType, profileSlugToId);
    setNewJobProductionTypeProfileId(next);
  }, [newJobProductionType, profileSlugToId]);

  // Post-parse Job-candidate fetch. Fires when we have both a parse
  // result AND a confirmed customer. Pulls active/recent Jobs for that
  // customer, filters to ones within a 60-day createdAt window OR with
  // date-overlap against the extracted shoot range. Auto-selects the
  // candidate when there's exactly one strong match (same customer +
  // >50% date overlap); otherwise the default "Create new Job" stays.
  useEffect(() => {
    if (!parsed || !realCompanyId(selectedClientId)) {
      setCandidateJobs([]);
      return;
    }
    fetch(`/api/jobs?companyId=${encodeURIComponent(selectedClientId)}&statuses=QUOTED,ACTIVE`)
      .then((r) => r.json())
      .then((d) => {
        const jobs: AttachableJob[] = Array.isArray(d.jobs) ? d.jobs : [];
        const cutoff = Date.now() - 60 * 86_400_000;
        const extractedStart = editing.startDate ? new Date(editing.startDate).getTime() : null;
        const extractedEnd = editing.endDate ? new Date(editing.endDate).getTime() : null;
        const filtered = jobs.filter((j) => {
          // Recency: any Job touched in the last 60 days is a candidate.
          const start = j.startDate ? new Date(j.startDate).getTime() : null;
          const end = j.endDate ? new Date(j.endDate).getTime() : start;
          const recent =
            (start && start >= cutoff) ||
            (end && end >= cutoff);
          // Date overlap with the extracted range.
          const overlap =
            extractedStart != null && extractedEnd != null && start != null && end != null &&
            extractedStart <= end && extractedEnd >= start;
          return recent || overlap;
        });
        setCandidateJobs(filtered);

        // Evidence-only auto-select: the email must actually reference
        // the Job — extracted production name equals the Job's name, or
        // the email text contains its job code. Date overlap alone is a
        // coincidence, not a reference (it used to auto-attach quotes to
        // whatever same-window job the customer had). Only fires when
        // the user hasn't already committed to a choice; otherwise we
        // would clobber their explicit pick on every re-fetch.
        if (job.mode === 'searching') {
          const extractedName = (editing.productionName || parsed?.productionName || '').trim().toLowerCase();
          const emailLower = emailText.toLowerCase();
          const referenced = filtered.filter((j) =>
            (extractedName && j.name.trim().toLowerCase() === extractedName) ||
            (j.jobCode && emailLower.includes(j.jobCode.toLowerCase()))
          );
          if (referenced.length === 1) {
            const only = referenced[0];
            setJob({
              jobId: only.id,
              jobCode: only.jobCode,
              name: only.name,
              mode: 'selected_existing',
              company: only.company,
            });
          }
        }
      })
      .catch(() => setCandidateJobs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, selectedClientId, editing.startDate, editing.endDate]);

  // Seed the Job picker's typed name from the inferred title once we
  // enter review mode and have nothing picked yet. Replaces the
  // standalone "Job Name" free-text input that pre-dated the unified
  // control. Only runs when the picker is still in `searching` mode
  // AND its name is blank — once the user picks/types, this effect
  // becomes a no-op via the guard.
  useEffect(() => {
    if (!parsed) return;
    const seed = parsed.productionName?.trim() || inquiry?.title?.trim() || '';
    if (!seed) return;
    setJob((prev) => {
      if (prev.mode !== 'searching' || prev.name) return prev;
      return { ...prev, name: seed };
    });
  }, [parsed, inquiry]);

  // Round-trip from /crm: when ?clientCompanyId is in the URL, fetch
  // the company by id, inject into the candidates dropdown, and
  // select it so the rest of the form binds correctly.
  useEffect(() => {
    if (!clientCompanyIdFromUrl) return;
    fetch(`/api/crm/companies/${clientCompanyIdFromUrl}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d?.id) return;
        const candidate: ClientCandidate = {
          id: d.id,
          name: d.name,
          tier: d.tier,
          coiOnFile: !!d.coiOnFile,
          defaultAgentId: d.defaultAgentId ?? null,
        };
        setClientCandidates((prev) => (prev.find((c) => c.id === candidate.id) ? prev : [candidate, ...prev]));
        setSelectedClientId(candidate.id);
      })
      .catch(() => {});
  }, [clientCompanyIdFromUrl]);

  // Inquiry prefill — only when ?inquiryId is set.
  // Two paths:
  //   (a) Regular inquiry (MANUAL / GMAIL): seed emailText + dates so
  //       the agent runs the AI parse against the description text.
  //   (b) Supply-order inquiry (WEB_FORM with kind='supply-order'):
  //       skip the parse step entirely. The cart snapshot in
  //       sourceMetadata IS the line-item source of truth — map each
  //       line to a ResolvedItem with catalogProductId bound to the
  //       InventoryItem, and jump straight to the review/JobPicker
  //       step.
  useEffect(() => {
    if (!inquiryId) return;
    fetch(`/api/inquiries/${inquiryId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.inquiry) return;
        const inq: InquiryRecord = d.inquiry;
        setInquiry(inq);

        const meta = inq.sourceMetadata ?? null;
        // Accept BOTH kind strings: the public order form (/api/public/supply-request)
        // actually writes 'production-order', while earlier code expected
        // 'supply-order'. Matching both makes the cart auto-prefill fire for new
        // AND already-submitted inquiries (which have 'production-order' stored).
        const isSupplyOrder =
          (meta?.kind === 'production-order' || meta?.kind === 'supply-order') &&
          Array.isArray(meta.cart) &&
          meta.cart.length > 0;

        if (isSupplyOrder) {
          // Build the post-parse state directly from the cart snapshot.
          // No AI parse runs; the user lands on the review step.
          // The real snapshot stores the window under `window`; older shape used
          // `dates`. Fall back to the inquiry's preferred dates either way.
          const startISO = (meta!.window?.start ?? meta!.dates?.start ?? inq.preferredStartDate ?? '').slice(0, 10);
          const endISO = (meta!.window?.end ?? meta!.dates?.end ?? inq.preferredEndDate ?? startISO).slice(0, 10);
          const fallbackProductionName =
            meta!.production?.jobName?.trim() ||
            inq.title.replace(/^(Supply|Production) request — /, '');

          // Synthetic ParsedTop so the page flips out of the "step 1
          // input" branch. The fields here also drive the
          // candidate-job lookup downstream.
          setParsed({
            clientName: meta!.production?.companyName ?? undefined,
            contactName: meta!.contact?.name ?? undefined,
            contactEmail: meta!.contact?.email ?? undefined,
            contactPhone: meta!.contact?.phone ?? undefined,
            productionName: fallbackProductionName || undefined,
            startDate: startISO || undefined,
            endDate: endISO || undefined,
            notes: meta!.notes ?? undefined,
          });
          setEditing((prev) => ({
            ...prev,
            productionName: prev.productionName || fallbackProductionName,
            startDate: prev.startDate || startISO,
            endDate: prev.endDate || endISO,
            notes: meta!.notes ?? prev.notes,
          }));

          // Cart → ResolvedItem[]. Map each line by its kind to the right
          // catalog target (no AI/alias matching — the ids are canonical):
          //   • VEHICLE → binds catalogType=INVENTORY, keyed by the merged
          //     catalog id (resolved server-side from the VehicleCategory in
          //     /api/inquiries/[id]). DAILY. If the VehicleCategory has no
          //     catalog row, leave it unmatched for the rep to resolve.
          //   • SUPPLY → INVENTORY by InventoryItem id; FLAT for EXPENDABLE
          //     consumables (qty × rate, no billable days), DAILY for EQUIPMENT.
          // Reads the ACTUAL cart-snapshot fields (qty, per-line dates).
          const fallbackStart = startISO || new Date().toISOString().slice(0, 10);
          const fallbackEnd = endISO || fallbackStart;
          const items: ResolvedItem[] = meta!.cart!.map((line) => {
            const qty = Math.max(1, Math.floor(line.qty ?? line.quantity ?? 1));
            const pickupDate = (line.pickupDate ?? fallbackStart).slice(0, 10);
            const returnDate = (line.returnDate ?? fallbackEnd).slice(0, 10);
            const base = {
              localId: newLocalId(),
              description: line.name,
              quantity: qty,
              qualifier: null,
              pickupDate,
              returnDate,
              rate: line.unitPrice,
              matchSource: null,
              warnings: [],
            };
            if (line.itemKind === 'VEHICLE') {
              const acId = line.assetCategoryId ?? null;
              return {
                ...base,
                catalogProductId: acId,
                catalogType: acId ? ('INVENTORY' as const) : null,
                department: 'VEHICLES' as const,
                rateType: 'DAILY' as const,
                billableDays: line.days ?? 1,
                claimedDays: line.claimedDays ?? null,
                matchedProduct: acId ? { id: acId, type: 'INVENTORY' as const, name: line.name } : null,
              };
            }
            const isExpendable = line.type === 'EXPENDABLE';
            return {
              ...base,
              catalogProductId: line.itemId,
              catalogType: 'INVENTORY' as const,
              department: (line.department ?? 'PRO_SUPPLIES') as ResolvedItem['department'],
              rateType: isExpendable ? ('FLAT' as const) : ('DAILY' as const),
              billableDays: isExpendable ? 1 : line.days ?? 1,
              claimedDays: isExpendable ? null : line.claimedDays ?? null,
              matchedProduct: { id: line.itemId, type: 'INVENTORY' as const, name: line.name },
            };
          });
          setItems(items);

          // Single synthetic contact from the cart — the agent
          // reviews it in PeopleSection. match_status='new' until
          // the agent picks an existing Person or accepts the
          // create-new path.
          if (meta!.contact?.email) {
            setContacts([
              {
                name: meta!.contact.name ?? '',
                email: meta!.contact.email,
                title: meta!.contact.role ?? null,
                phone: meta!.contact.phone ?? null,
                company: meta!.production?.companyName ?? null,
                suggested_role: 'PC',
                source: 'header',
                confidence: 'high',
                match_status: 'new',
                existing_person_id: null,
                candidate_person_id: null,
                include: true,
                role: 'PC',
              },
            ]);
          }

          if (inq.company) {
            setSelectedClientId((cur) => cur || inq.company!.id);
          }
          return;
        }

        // Default path — non-supply-order inquiry. Seed emailText
        // so the agent can hit "Parse" against the description.
        setEmailText(inq.description || '');
        setEditing((prev) => ({
          ...prev,
          productionName: prev.productionName || inq.title,
          startDate: prev.startDate || (inq.preferredStartDate ? inq.preferredStartDate.slice(0, 10) : undefined),
          endDate: prev.endDate || (inq.preferredEndDate ? inq.preferredEndDate.slice(0, 10) : undefined),
        }));
        if (inq.company) {
          setSelectedClientId((cur) => cur || inq.company!.id);
        }
      })
      .catch(() => {});
  }, [inquiryId]);

  // Map API contacts → UI rows. include defaults true for high/medium
  // confidence (header + well-formed signature) and false for low
  // confidence body mentions, so the agent has to opt in to creating
  // CRM rows from passing references in the body text.
  const hydrateContacts = (apiContacts: unknown): ResolvedContact[] => {
    if (!Array.isArray(apiContacts)) return [];
    return apiContacts.map((c) => {
      const role: SuggestedJobRole = (c.suggested_role as SuggestedJobRole) || 'OTHER';
      return {
        name: String(c.name || ''),
        email: String(c.email || ''),
        title: c.title ?? null,
        phone: c.phone ?? null,
        company: c.company ?? null,
        suggested_role: (c.suggested_role as SuggestedJobRole) || null,
        source: c.source,
        confidence: c.confidence,
        match_status: c.match_status,
        existing_person_id: c.existing_person_id ?? null,
        candidate_person_id: c.candidate_person_id ?? null,
        include: c.confidence !== 'low',
        role,
        decision: c.match_status === 'possible_match' ? 'create_new' : undefined,
      };
    });
  };

  const parseEmail = async () => {
    if (!emailText.trim()) return;
    setParsing(true);
    try {
      const res = await fetch('/api/orders/parse-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: emailText }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Parse failed');
        return;
      }
      setParsed(data.parsed);
      setEditing((prev) => ({
        productionName: prev.productionName || data.parsed?.productionName,
        startDate: prev.startDate || data.parsed?.startDate,
        endDate: prev.endDate || data.parsed?.endDate,
        pickupLocation: data.parsed?.pickupLocation,
        notes: data.parsed?.notes,
        ...prev,
      }));
      setItems(withLocalIds(data.items || []));
      setClientCandidates(data.clientMatch || []);
      setContacts(hydrateContacts(data.contacts));
      // Evidence-only prefill: name matches from the parsed email render
      // as tappable candidate chips above the CompanyPicker — never
      // auto-selected, even when there's exactly one hit. (The old
      // single-hit auto-select is how a loose fuzzy match silently
      // became the quote's client.)
      if (!newJobNotes && data.parsed?.notes) {
        setNewJobNotes(data.parsed.notes);
      }
    } finally {
      setParsing(false);
    }
  };

  const parsePDF = async () => {
    if (!pdfFile) return;
    setParsing(true);
    setPdfError(null);
    try {
      const fd = new FormData();
      fd.append('file', pdfFile);
      const pdfRes = await fetch('/api/orders/parse-pdf', { method: 'POST', body: fd });
      const pdfData = await pdfRes.json();
      if (!pdfRes.ok) {
        setPdfError(pdfData.error || null);
        return;
      }
      setEmailText(pdfData.text);
      const parseRes = await fetch('/api/orders/parse-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pdfData.text }),
      });
      const parseData = await parseRes.json();
      if (!parseRes.ok) {
        setPdfError(parseData.error || null);
        return;
      }
      setParsed(parseData.parsed);
      setEditing((prev) => ({ ...prev, ...parseData.parsed }));
      setItems(withLocalIds(parseData.items || []));
      setClientCandidates(parseData.clientMatch || []);
      setContacts(hydrateContacts(parseData.contacts));
    } finally {
      setParsing(false);
    }
  };

  /** Fill the department-default billable-days suggestion once a row has
   *  BOTH dates and no rep-entered value yet (Wes 2026-08-31: "no way to
   *  apply the start/end dates and then have the option on 1d 2d week" —
   *  dates used to land on a line and leave days at TBD, so the week-cap
   *  picker had nothing to stand on). Never overwrites a non-null value;
   *  the picker and the input remain the override paths. */
  function suggestDaysIfReady(it: ResolvedItem): ResolvedItem {
    if (it.billableDays != null) return it;
    if (!it.pickupDate || !it.returnDate) return it;
    const rules = BILLING_RULES[it.department];
    if (rules.model === 'PURCHASE') return it;
    const cal = calendarDays(new Date(it.pickupDate), new Date(it.returnDate));
    if (!Number.isFinite(cal)) return it;
    const days = rules.model === 'CAP_PER_WEEK' ? computeBillableDays(cal, rules.cap) : cal;
    return { ...it, billableDays: days };
  }

  const updateItem = (id: string, patch: Partial<ResolvedItem>) => {
    setItems((prev) => {
      const target = prev.find((it) => it.localId === id);
      if (!target) return prev;

      // Header-driven cascade: when a package header's pickupDate /
      // returnDate / billableDays changes, all members in the same
      // packageInstance inherit. Availability depends on member dates
      // staying in sync; reps shouldn't have to walk each row.
      const headerCascadeFields = (['pickupDate', 'returnDate', 'billableDays'] as const)
        .filter((f) => patch[f] !== undefined && patch[f] !== target[f])
      if (target.isPackageHeader && target.packageInstanceId && headerCascadeFields.length > 0) {
        return prev.map((it) => {
          if (it.localId === id) return applyRowPatch(it, patch)
          if (it.packageInstanceId === target.packageInstanceId && it.isPackageMember) {
            const memberPatch: Partial<ResolvedItem> = {}
            for (const f of headerCascadeFields) {
              memberPatch[f] = patch[f] as never
            }
            return { ...it, ...memberPatch }
          }
          return it
        })
      }

      // Member-driven modification: any structural edit to a member
      // (qty / description / rate) flags the header as modified so
      // the rep sees the amber dot. Date changes on a member are
      // allowed without flagging — the spec scopes the warning to
      // contents (qty / membership / pricing).
      const memberStructuralEdit =
        target.isPackageMember &&
        target.packageInstanceId &&
        (patch.quantity !== undefined || patch.description !== undefined || patch.rate !== undefined)
      if (memberStructuralEdit) {
        return prev.map((it) => {
          if (it.localId === id) return applyRowPatch(it, patch)
          if (it.packageInstanceId === target.packageInstanceId && it.isPackageHeader) {
            return { ...it, isPackageModified: true }
          }
          return it
        })
      }

      return prev.map((it) => (it.localId === id ? applyRowPatch(it, patch) : it))
    });
  };

  // Pulled out so the header-cascade and member-edit paths can reuse
  // the same rateType-normalization logic.
  function applyRowPatch(it: ResolvedItem, patch: Partial<ResolvedItem>): ResolvedItem {
        let next: ResolvedItem = { ...it, ...patch };
        // Dates just became (or changed while) complete → seed the
        // suggested day count if the rep hasn't typed one.
        if (patch.pickupDate !== undefined || patch.returnDate !== undefined || patch.department !== undefined) {
          next = suggestDaysIfReady(next);
        }

        // Department change: normalize rateType to keep stored data consistent.
        // - EXPENDABLES → FLAT (with note; toggle disappears anyway).
        // - STAGES → DAILY when previously something else (with note; visible toggle).
        // - Cap-per-week (COM/PS/ART/VEH/GE) → DAILY silently. The rateType
        //   column is vestigial for these departments — there's no toggle
        //   to reset, so an inline note would confuse the user.
        if (patch.department !== undefined && patch.department !== it.department) {
          if (next.department === 'EXPENDABLES') {
            if (next.rateType !== 'FLAT') {
              next.rateType = 'FLAT';
              next.rateTypeAutoResetNote = 'Rate type reset to Purchase — Expendables are always purchases.';
            }
          } else if (next.department === 'STAGES') {
            if (next.rateType !== 'DAILY') {
              next.rateType = 'DAILY';
              next.rateTypeAutoResetNote = 'Rate type reset to Daily — billing changes with department.';
            }
          } else {
            // Cap-per-week: silent normalization to DAILY.
            next.rateType = 'DAILY';
            next.rateTypeAutoResetNote = null;
          }
        } else if (
          (patch.pickupDate !== undefined && patch.pickupDate !== it.pickupDate) ||
          (patch.returnDate !== undefined && patch.returnDate !== it.returnDate)
        ) {
          // Per-line date change: re-evaluate rateType availability against
          // the new calendar window. Only matters for STAGES; cap-per-week
          // and EXPENDABLES have no toggle.
          const pickup = new Date(next.pickupDate);
          const ret = new Date(next.returnDate);
          const valid = availableRateTypes(next.department, pickup, ret);
          if (valid.length > 0 && !valid.includes(next.rateType)) {
            const reset = defaultRateType(next.department, pickup, ret);
            const reason =
              next.rateType === 'MONTHLY'
                ? 'Monthly requires more than 28 calendar days'
                : next.rateType === 'WEEKLY'
                  ? 'Weekly requires more than 7 calendar days'
                  : 'rate type unavailable';
            next.rateType = reset;
            next.rateTypeAutoResetNote = `Rate type reset to ${rateTypeLabel(reset)} — ${reason}.`;
          }
        } else if (
          patch.rateType !== undefined ||
          patch.quantity !== undefined ||
          patch.rate !== undefined ||
          patch.description !== undefined
        ) {
          // User-initiated edit — clear any lingering reset note.
          next.rateTypeAutoResetNote = null;
        }
        return next;
  }

  // Frictionless remove + undo toast. We snapshot the item AND its
  // index so the undo restores it exactly where it was (otherwise
  // sorting / grouping would land it at the end of its department).
  const removeItem = (id: string) => {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.localId === id);
      if (idx < 0) return prev;
      const removed = prev[idx];
      // Package header deletion cascades — confirm with the rep
      // first. The members share packageInstanceId; we snapshot
      // them all so undo restores the entire bundle.
      if (removed.isPackageHeader && removed.packageInstanceId) {
        const ok = confirm('Remove entire package? All member lines will be removed too.');
        if (!ok) return prev;
        const instanceId = removed.packageInstanceId;
        const removedBundle = prev
          .map((it, i) => ({ it, i }))
          .filter(({ it }) => it.packageInstanceId === instanceId);
        const next = prev.filter((it) => it.packageInstanceId !== instanceId);
        setUndoToast({
          label: `${removed.description || '(package)'} (${removedBundle.length} lines)`,
          onUndo: () => {
            setItems((current) => {
              const restored = [...current];
              // Re-insert at the lowest original index.
              const insertAt = Math.min(removedBundle[0].i, restored.length);
              restored.splice(insertAt, 0, ...removedBundle.map((b) => b.it));
              return restored;
            });
          },
          onDismiss: () => setUndoToast(null),
        });
        return next;
      }
      // Member-line deletion flags the header as modified.
      if (removed.isPackageMember && removed.packageInstanceId) {
        const instanceId = removed.packageInstanceId;
        const next = prev.filter((it) => it.localId !== id).map((it) =>
          it.packageInstanceId === instanceId && it.isPackageHeader
            ? { ...it, isPackageModified: true }
            : it,
        );
        setUndoToast({
          label: removed.description || '(line item)',
          onUndo: () => {
            setItems((current) => {
              const restored = [...current];
              restored.splice(Math.min(idx, restored.length), 0, removed);
              return restored;
            });
          },
          onDismiss: () => setUndoToast(null),
        });
        return next;
      }
      const next = prev.filter((it) => it.localId !== id);
      setUndoToast({
        label: removed.description || '(line item)',
        onUndo: () => {
          setItems((current) => {
            const restored = [...current];
            restored.splice(Math.min(idx, restored.length), 0, removed);
            return restored;
          });
        },
        onDismiss: () => setUndoToast(null),
      });
      return next;
    });
  };

  // Department-group bulk update: apply a partial patch to every line item
  // in the group. Empty / undefined fields are skipped. Apply is an explicit
  // override action — it overwrites custom per-line values too (vs. the
  // quote-level date propagation which respects per-line overrides).
  const setBulkForDept = (
    dept: LineItemDepartment,
    patch: { pickupDate?: string; returnDate?: string; billableDays?: number },
  ) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.department !== dept) return it;
        const next = { ...it };
        if (patch.pickupDate) next.pickupDate = patch.pickupDate;
        if (patch.returnDate) next.returnDate = patch.returnDate;
        if (patch.billableDays && patch.billableDays > 0) next.billableDays = patch.billableDays;
        // Bulk dates with no explicit day count → seed the department
        // default so the week-cap picker has a value to stand on.
        return suggestDaysIfReady(next);
      }),
    );
  };

  // ── Promote a custom line into the catalog (Wes 2026-08-31: "when
  //    there is a custom item, there should be a prompt to add the
  //    item"). The "+ add" chip on an unbound line opens AddItemModal
  //    seeded from the line; on create the line binds to the new item.
  const [addCatalogForId, setAddCatalogForId] = useState<string | null>(null);
  const [catalogMeta, setCatalogMeta] = useState<{
    categories: { id: string; name: string; department?: string }[];
    locations: { id: string; name: string; code: string }[];
  } | null>(null);
  const openAddToCatalog = (id: string) => {
    setAddCatalogForId(id);
    if (!catalogMeta) {
      // Same payload the inventory page reads — one light fetch, cached
      // for the session.
      fetch('/api/inventory/items?limit=1')
        .then((r) => r.json())
        .then((d) => setCatalogMeta({ categories: d.categories || [], locations: d.locations || [] }))
        .catch(() => setCatalogMeta({ categories: [], locations: [] }));
    }
  };
  const handleCatalogCreated = (created?: CreatedInventoryItem) => {
    if (!created || !addCatalogForId) return;
    updateItem(addCatalogForId, {
      catalogProductId: created.id,
      catalogType: 'INVENTORY',
      department: (created.department as LineItemDepartment) || undefined,
      matchedProduct: {
        id: created.id,
        type: 'INVENTORY',
        name: created.description || created.code,
      },
      matchSource: null,
      // The modal may have carried a rate the line didn't have.
      ...(Number(created.dailyRate) > 0 && !(items.find((i) => i.localId === addCatalogForId)?.rate)
        ? { rate: Number(created.dailyRate) }
        : {}),
    });
  };

  // ── Fees (Wes 2026-08-31: "add delivery and pickup to the quote
  //    builder fee section"). The builder had no fee surface at all —
  //    fees could only be added on /orders/[id] after the order
  //    existed, so a quote that included a delivery run went out
  //    without it. Deliberately the two RUN fees rather than the whole
  //    31-fee catalog: those are what a quote needs at build time, and
  //    the order page keeps the full picker for everything else.
  //    Amounts come from the catalog (so /admin/fees stays the price
  //    authority) but are editable here as an override request the
  //    server re-checks and audits, exactly like a gear rate.
  const FEE_CODES = ['DEL', 'PICKUP'] as const;
  interface BuilderFee {
    id: string;
    code: string;
    name: string;
    catalogAmount: number;
    description: string | null;
  }
  const [feeCatalog, setFeeCatalog] = useState<BuilderFee[] | null>(null);
  // code → { on, rate, quantity }. Absent = not on the quote.
  const [feeSelections, setFeeSelections] = useState<
    Record<string, { on: boolean; rate: number; quantity: number }>
  >({});
  // Damage waiver (LCDW) — ON by default (Wes 2026-09-10: "better if they
  // have to remove it"). The rep can untick it here; the client can decline
  // it in the portal, and a signed refusal takes the line off. Priced by
  // the server (applyLcdwToOrder, the one pricer) after the order exists;
  // this only carries the decision and shows an estimate.
  const [lcdwOn, setLcdwOn] = useState(true);
  const [lcdwFee, setLcdwFee] = useState<{ id: string; amount: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/fees')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        const all: any[] = Array.isArray(d) ? d : d.fees || [];
        const picked: BuilderFee[] = FEE_CODES.map((code) => {
          const f = all.find((x) => x.code === code);
          return f
            ? { id: f.id, code: f.code, name: f.name, catalogAmount: Number(f.amount), description: f.description ?? null }
            : null;
        }).filter(Boolean) as BuilderFee[];
        setFeeCatalog(picked);
        const lf = all.find((x) => x.code === LCDW_FEE_CODE);
        setLcdwFee(lf ? { id: lf.id, amount: Number(lf.amount) } : null);
        setFeeSelections((prev) => {
          const next = { ...prev };
          for (const f of picked) {
            if (!next[f.code]) next[f.code] = { on: false, rate: f.catalogAmount, quantity: 1 };
          }
          return next;
        });
      })
      // A fee-catalog outage must not break the builder — the section
      // just doesn't render, and fees stay addable on the order page.
      .catch(() => { if (!cancelled) setFeeCatalog([]); });
    return () => { cancelled = true; };
  }, []);

  /** Fee lines destined for the save payload. */
  const activeFees = useMemo(
    () =>
      (feeCatalog ?? [])
        .map((f) => ({ fee: f, sel: feeSelections[f.code] }))
        .filter((x) => x.sel?.on)
        .map((x) => ({
          feeItemId: x.fee.id,
          description: x.fee.name,
          quantity: Math.max(1, Math.floor(x.sel!.quantity || 1)),
          rate: x.sel!.rate,
        })),
    [feeCatalog, feeSelections],
  );
  const feeTotal = useMemo(
    () => activeFees.reduce((sum, f) => sum + f.quantity * f.rate, 0),
    [activeFees],
  );
  // Client-side ESTIMATE of the waiver — the builder's lines carry no
  // catalog code, so a specialty vehicle is caught by name here and by
  // the catalog row on the server. The server's answer is the one that
  // prices; this is what the checkbox reads.
  const lcdwEstimate = useMemo(() => {
    const q = quoteLcdw(
      items.map((it, i) => ({
        id: String(i),
        description: it.description,
        code: null,
        department: String(it.department),
        quantity: it.quantity,
        billableDays: it.billableDays ?? null,
      })),
    );
    return { vehicleDays: q.vehicleDays, eligible: q.eligible.length, excluded: q.excluded.length, allExcluded: q.allExcluded };
  }, [items]);

  /** Which sections the agent has deliberately answered the week
   *  question for. Set by the section select and by the pre-send prompt;
   *  read only by `weekDecisionsPending`, which also treats hand-typed
   *  day counts as an answer (they read as 'custom'). Session-scoped —
   *  nothing persists, because nothing here is a fact about the order,
   *  only about whether someone was asked. */
  const [weekDecided, setWeekDecided] = useState<Partial<Record<LineItemDepartment, number>>>({});

  /** Section-level week cap (Wes 2026-08-31: "selectable by section and
   *  applied to whole section"): reprice EVERY dated line in the
   *  department at `cap` days per 7-day week, from each line's own
   *  calendar range. Overwrites existing day counts — that is the point
   *  of a section-wide control; per-line dissent goes through the days
   *  input afterwards. Undated (TBD) lines are skipped, not guessed.
   *
   *  Specialty vehicles are skipped too (Wes 2026-09-07, the class
   *  2026-09-10): they bill calendar days with no weekly reduction, the
   *  order page shows them no cap chips, and bulk-days / dates-apply
   *  refuse to write one. A section-wide cap must not be the one door
   *  that discounts them. The builder sees only the NAME rule — a
   *  catalogued specialty unit still slips through here. */
  const applyWeekCapToDept = (dept: LineItemDepartment, cap: number) => {
    setWeekDecided((prev) => ({ ...prev, [dept]: cap }));
    setItems((prev) =>
      prev.map((it) => {
        if (it.department !== dept) return it;
        if (!it.pickupDate || !it.returnDate) return it;
        if (weekCapExempt(weekLine(it))) return it;
        const cal = calendarDays(new Date(it.pickupDate), new Date(it.returnDate));
        if (!Number.isFinite(cal)) return it;
        return { ...it, billableDays: computeBillableDays(cal, cap) };
      }),
    );
  };

  // Quote-level date change: propagate to line items whose pickupDate /
  // returnDate currently matches the old quote-level value (i.e., haven't
  // been individually overridden). Lines with custom dates stay as-is.
  const updateQuoteDate = (field: 'startDate' | 'endDate', newValue: string) => {
    const oldValue = editing[field] || '';
    setEditing((prev) => ({ ...prev, [field]: newValue }));
    // First-time entry used to early-return on empty oldValue, so the
    // window NEVER reached lines added before the dates were typed —
    // "no way to apply the start/end dates" (Wes 2026-08-31). Cascade
    // to lines still on the old quote date AND lines with no date yet;
    // a per-line custom date is left alone either way.
    if (!newValue || newValue === oldValue) return;
    setItems((prev) =>
      prev.map((it) => {
        const lineField = field === 'startDate' ? 'pickupDate' : 'returnDate';
        if (it[lineField] === oldValue || !it[lineField]) {
          return suggestDaysIfReady({ ...it, [lineField]: newValue });
        }
        return it;
      }),
    );
  };

  // Append a blank row in `dept`. Dates inherit from the quote-level
  // window when set, else stay TBD. Returns the new row's localId so
  // callers (per-category +, manual-add button, commit-then-append)
  // can park focus on it.
  const addRowToDept = (dept: LineItemDepartment, opts?: { focus?: boolean }): string => {
    const pickup = editing.startDate || '';
    const ret = editing.endDate || '';
    const localId = newLocalId();
    setItems((prev) => [
      ...prev,
      {
        localId,
        description: '',
        quantity: 1,
        catalogProductId: null,
        catalogType: null,
        department: dept,
        qualifier: null,
        // EXPENDABLES are purchase-only; everything else defaults daily.
        rateType: dept === 'EXPENDABLES' ? 'FLAT' : 'DAILY',
        pickupDate: pickup,
        returnDate: ret,
        // null when both dates are unset; will become a computed value
        // when the rep commits dates. Never silently 1.
        billableDays: null,
        rate: 0,
        matchedProduct: null,
        matchSource: null,
        warnings: [],
      },
    ]);
    if (opts?.focus !== false) setPendingFocusId(localId);
    return localId;
  };

  const addBlankItem = () => { addRowToDept('PRO_SUPPLIES'); };

  // ─── Auto-append + focus management for the combobox flow ───────
  // Refs keyed by row.localId. Combobox registers its underlying input
  // ref on mount; we use it to focus either the next existing row
  // (same dept) or a freshly appended blank row after commit.
  // `pendingFocusId` is the "next row I want to focus once it's
  // rendered" — the effect below applies it.
  const descriptionRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  const registerDescriptionRef = useCallback((id: string) => (el: HTMLInputElement | null) => {
    if (el) descriptionRefs.current.set(id, el);
    else descriptionRefs.current.delete(id);
  }, []);

  useEffect(() => {
    if (pendingFocusId == null) return;
    const el = descriptionRefs.current.get(pendingFocusId);
    if (el) {
      // Defer to next microtask so layout has settled.
      requestAnimationFrame(() => {
        el.focus();
        // Position cursor at end for fast continuous entry.
        const v = el.value;
        el.setSelectionRange(v.length, v.length);
      });
      setPendingFocusId(null);
    }
  }, [pendingFocusId, items.length]);

  // Package pick: replace the current row with a HEADER carrying the
  // package's pricePerDay + insert MEMBER rows after it (rate=0,
  // shared packageInstanceId). Members render indented under the
  // header. Header price drives the order math; members are $0.
  const handlePickPackage = useCallback((
    targetId: string,
    hit: import('@/components/orders/LineItemDescriptionCombobox').CatalogHit,
  ) => {
    if (!hit.items || hit.items.length === 0) return;
    const instanceId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setItems((prev) => {
      const targetIdx = prev.findIndex((it) => it.localId === targetId);
      if (targetIdx < 0) return prev;
      const target = prev[targetIdx];
      const pickup = target.pickupDate;
      const ret = target.returnDate;
      const days = target.billableDays;
      const header: ResolvedItem = {
        ...target,
        // Header keeps the original row's localId so focus / refs
        // stay continuous through the in-place replacement.
        description: hit.name,
        catalogProductId: hit.id,
        catalogType: 'PACKAGE',
        department: hit.department as LineItemDepartment,
        rate: hit.dailyRate,
        quantity: 1,
        matchedProduct: { id: hit.id, type: 'PACKAGE', name: hit.name },
        matchSource: 'AI',
        packageInstanceId: instanceId,
        packageId: hit.id,
        isPackageHeader: true,
        isPackageMember: false,
        isPackageModified: false,
      };
      const members: ResolvedItem[] = hit.items!.map((m) => ({
        localId: newLocalId(),
        description: m.name,
        quantity: m.qty,
        catalogProductId: m.inventoryItemId,
        catalogType: 'INVENTORY',
        department: m.department as LineItemDepartment,
        qualifier: null,
        rateType: 'DAILY',
        pickupDate: pickup,
        returnDate: ret,
        billableDays: days,
        rate: 0,
        matchedProduct: { id: m.inventoryItemId, type: 'INVENTORY', name: m.name },
        matchSource: 'AI',
        warnings: [],
        packageInstanceId: instanceId,
        packageId: hit.id,
        isPackageHeader: false,
        isPackageMember: true,
        isPackageModified: false,
      }));
      const next = [...prev];
      next.splice(targetIdx, 1, header, ...members);
      return next;
    });
  }, []);

  const handleRowCommit = useCallback((committedId: string) => {
    const committedIdx = items.findIndex((it) => it.localId === committedId);
    if (committedIdx < 0) return;
    const committed = items[committedIdx];
    // Look for the next existing row in the same department.
    const sameDept = items
      .map((it, i) => ({ it, i }))
      .filter((r) => r.it.department === committed.department);
    const positionInDept = sameDept.findIndex((r) => r.i === committedIdx);
    const nextSameDept = sameDept[positionInDept + 1];
    if (nextSameDept) {
      setPendingFocusId(nextSameDept.it.localId);
      return;
    }
    // Append a fresh blank row in the same department + focus its
    // combobox. (STEP 1C) No today/tomorrow defaults — TBD until the
    // rep commits dates.
    addRowToDept(committed.department);
  }, [items, editing.startDate, editing.endDate]);

  /** Per-department line subtotals — the base a DEPARTMENT discount applies to. */
  const departmentSubtotals = useMemo(() => {
    const out: Partial<Record<LineItemDepartment, number>> = {};
    for (const it of items) {
      out[it.department] =
        (out[it.department] ?? 0) +
        computeLineTotal({
          quantity: it.quantity,
          rate: it.rate,
          billableDays: it.billableDays,
          rateType: it.rateType,
          department: it.department,
        });
    }
    return out;
  }, [items]);

  /**
   * What each discount actually takes off, in dollars.
   *
   * Department discounts resolve against THEIR department's subtotal and are
   * applied first; the order-scope discount then works on what's left. Same
   * order of operations as the saved order (discountedTotals.ts), so the
   * draft preview and the created order agree. Each is clamped to its own
   * base so a 120%-off typo can't invert the total.
   */
  const discountBreakdown = useMemo(() => {
    const lineSum = Object.values(departmentSubtotals).reduce((a, b) => a + (b ?? 0), 0);
    const rows = discounts.map((d) => {
      const base =
        d.scope === 'DEPARTMENT' && d.departmentKey
          ? departmentSubtotals[d.departmentKey] ?? 0
          : lineSum;
      const raw = d.type === 'PERCENT' ? (base * d.value) / 100 : d.value;
      return { ...d, base, applied: Math.min(Math.max(raw, 0), base) };
    });
    const deptTaken = rows
      .filter((r) => r.scope === 'DEPARTMENT')
      .reduce((a, r) => a + r.applied, 0);
    const afterDept = Math.max(0, lineSum - deptTaken);
    // Re-clamp order-scope against the post-department remainder.
    const withOrder = rows.map((r) =>
      r.scope === 'ORDER'
        ? {
            ...r,
            base: afterDept,
            applied: Math.min(
              r.type === 'PERCENT' ? (afterDept * r.value) / 100 : r.value,
              afterDept,
            ),
          }
        : r,
    );
    const total = withOrder.reduce((a, r) => a + r.applied, 0);
    return { lineSum, rows: withOrder, total };
  }, [discounts, departmentSubtotals]);

  // Is a unit actually FREE for each vehicle line? (Wes 2026-09-10: the
  // parser missed a cargo van, he added it by hand, "there was no prompt
  // to put a van on reservation … this could cause issues if the quote
  // goes out and there isn't an available unit"). Saving holds the class
  // and binds next-available on its own; this is the readout BEFORE the
  // quote goes out, per line, for its own dates. Cached per
  // product+window so typing elsewhere does not refetch.
  type VehicleAvailUnit = { assetId: string; unitName: string; tier: 'PREMIUM' | 'STANDARD' | 'ECONOMY'; state: 'free' | 'buffer' | 'booked' };
  type VehicleAvail =
    | { status: 'loading' }
    | { status: 'na' }
    | { status: 'ok'; free: number; total: number; category: string | null; categoryId: string | null; units: VehicleAvailUnit[] };
  const [vehicleAvail, setVehicleAvail] = useState<Record<string, VehicleAvail>>({});
  const availKey = (it: ResolvedItem) =>
    it.department === 'VEHICLES' && it.catalogProductId && (it.catalogType === 'INVENTORY' || it.catalogType === 'ASSET_CATEGORY') && it.pickupDate && it.returnDate
      ? `${it.catalogType}:${it.catalogProductId}|${it.pickupDate}|${it.returnDate}`
      : null;
  useEffect(() => {
    const wanted = new Map<string, ResolvedItem>();
    for (const it of items) { const k = availKey(it); if (k && !vehicleAvail[k]) wanted.set(k, it); }
    if (wanted.size === 0) return;
    setVehicleAvail((prev) => { const next = { ...prev }; for (const k of wanted.keys()) next[k] = { status: 'loading' }; return next; });
    let cancelled = false;
    for (const [k, it] of wanted) {
      const param = it.catalogType === 'ASSET_CATEGORY' ? `categoryId=${encodeURIComponent(it.catalogProductId!)}` : `inventoryItemId=${encodeURIComponent(it.catalogProductId!)}`;
      fetch(`/api/scheduling/availability?${param}&start=${it.pickupDate}&end=${it.returnDate}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          const v: VehicleAvail = d?.ok && d.holdable !== false
            ? {
                status: 'ok',
                free: Number(d.freeCount ?? 0),
                total: Number(d.serviceableCount ?? 0),
                category: d.category?.name ?? null,
                categoryId: (typeof d.categoryId === 'string' ? d.categoryId : d.category?.id) ?? null,
                units: Array.isArray(d.units) ? (d.units as VehicleAvailUnit[]) : [],
              }
            : { status: 'na' };
          setVehicleAvail((prev) => ({ ...prev, [k]: v }));
        })
        .catch(() => { if (!cancelled) setVehicleAvail((prev) => ({ ...prev, [k]: { status: 'na' } })); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  /** One note per vehicle line, for the VEHICLES group strip. */
  const vehicleAvailNotes = useMemo(() => {
    const out: { localId: string; tone: 'good' | 'bad' | 'muted'; text: string }[] = [];
    for (const it of items) {
      if (it.department !== 'VEHICLES') continue;
      const k = availKey(it);
      const need = Math.max(1, it.quantity || 1);
      if (!k) {
        if (!it.catalogProductId) out.push({ localId: it.localId, tone: 'bad', text: `${it.description || 'Vehicle'}: not matched to the catalog — nothing will be reserved for it. Pick it from the list.` });
        else if (!it.pickupDate || !it.returnDate) out.push({ localId: it.localId, tone: 'muted', text: `${it.description}: dates TBD — availability unknown.` });
        continue;
      }
      const a = vehicleAvail[k];
      if (!a || a.status === 'loading') out.push({ localId: it.localId, tone: 'muted', text: `${it.description}: checking the board…` });
      else if (a.status === 'na') out.push({ localId: it.localId, tone: 'muted', text: `${it.description}: not a unit-tracked vehicle — no reservation.` });
      else if (a.free >= need) out.push({ localId: it.localId, tone: 'good', text: `${it.description}: ${a.free} of ${a.total} free ${it.pickupDate} – ${it.returnDate} — ${need === 1 ? 'one' : need} will be reserved on save.` });
      else out.push({ localId: it.localId, tone: 'bad', text: `${it.description}: only ${a.free} of ${a.total} free ${it.pickupDate} – ${it.returnDate}, ${need} asked — the quote would go out ${a.free === 0 ? 'with no unit' : 'short'}. Move the dates, or check the board.` });
    }
    return out;
  }, [items, vehicleAvail]);

  // ── Reservation section (Wes 2026-09-12) ──────────────────────────
  // "There is a reservation section at the top where you can reserve an
  // asset, click to add another asset as many times as wanted and then
  // add order — it asks if will call or loaded onto one of the assets
  // reserved." The section IS the VEHICLES group, promoted above the
  // rest of the order and given two things the group never had: a
  // fleet-class picker that adds a bound line in one click, and a
  // per-line "which unit" picker. The line is still a line — priced,
  // dated and held on save exactly like a vehicle the parser found.

  /** The fleet class a vehicle line will hold — the legacy category id
   *  the scheduling routes key on. Known for a class pick outright; for
   *  a merged-catalog (INVENTORY) row it arrives with the availability
   *  read. */
  const holdCategoryIdOf = (it: ResolvedItem): string | null => {
    if (it.catalogType === 'ASSET_CATEGORY') return it.catalogProductId;
    const k = availKey(it);
    const a = k ? vehicleAvail[k] : null;
    return a && a.status === 'ok' ? a.categoryId : null;
  };

  /** Which specific truck(s) the rep named per vehicle line, by localId.
   *  Empty = next available. Never longer than the line's quantity. */
  const [unitPicks, setUnitPicks] = useState<Record<string, string[]>>({});
  const [openUnitPickers, setOpenUnitPickers] = useState<Record<string, boolean>>({});
  const toggleUnitPick = (it: ResolvedItem, assetId: string) => {
    setUnitPicks((prev) => {
      const cur = prev[it.localId] ?? [];
      const max = Math.max(1, it.quantity || 1);
      const next = cur.includes(assetId) ? cur.filter((x) => x !== assetId) : cur.length >= max ? cur : [...cur, assetId];
      return { ...prev, [it.localId]: next };
    });
  };
  // A pick that outlives its line, its window or its quantity is dropped:
  // the units offered are per (product, window), so moving the dates
  // empties the choice rather than carrying a truck that is booked then.
  useEffect(() => {
    setUnitPicks((prev) => {
      const next: Record<string, string[]> = {};
      for (const it of items) {
        const cur = prev[it.localId];
        if (!cur || cur.length === 0) continue;
        const k = availKey(it);
        const a = k ? vehicleAvail[k] : null;
        if (!a || a.status !== 'ok') { next[it.localId] = cur; continue; } // still loading — keep
        const offered = new Set(a.units.filter((u) => u.state !== 'booked').map((u) => u.assetId));
        const kept = cur.filter((id) => offered.has(id)).slice(0, Math.max(1, it.quantity || 1));
        if (kept.length > 0) next[it.localId] = kept;
      }
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, vehicleAvail]);

  /** The fleet classes a vehicle can be reserved from — the feed the
   *  gantt's Make Reservation uses, VEHICLES only. */
  const [fleetClasses, setFleetClasses] = useState<
    { id: string; inventoryItemId: string | null; name: string; code: string | null; totalUnits: number; dailyRate: number | null; recentDemand: number }[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/scheduling/categories')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.ok) return;
        const rows = (d.categories as {
          id: string; inventoryItemId?: string | null; name: string; code?: string | null; totalUnits: number; department: string; dailyRate: number | null; recentDemand?: number;
        }[])
          .filter((c) => c.department === 'VEHICLES')
          .map((c) => ({ id: c.id, inventoryItemId: c.inventoryItemId ?? null, name: c.name, code: c.code ?? null, totalUnits: c.totalUnits, dailyRate: c.dailyRate, recentDemand: c.recentDemand ?? 0 }));
        setFleetClasses(rows);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [classPickBusy, setClassPickBusy] = useState(false);
  /** "+ Reserve a vehicle": one line per pick, bound to the merged
   *  catalog row the way the combobox binds it (INVENTORY id) so the
   *  hold, the unit and the rate card all find it — priced off the
   *  client's negotiated rate when they have one, else list. */
  const reserveClass = async (classId: string) => {
    const c = fleetClasses.find((x) => x.id === classId);
    if (!c) return;
    setClassPickBusy(true);
    try {
      let bound: { id: string; type: CatalogType; dailyRate: number; weeklyRate: number } | null = null;
      if (c.inventoryItemId) {
        const cid = realCompanyId(selectedClientId);
        try {
          const r = await fetch(
            `/api/catalog/search?q=${encodeURIComponent(c.name)}&limit=10&types=ASSET_CATEGORY${cid ? `&companyId=${encodeURIComponent(cid)}` : ''}`,
          );
          const d = r.ok ? await r.json() : null;
          const hit = ((d?.results ?? []) as { id: string; dailyRate: number; weeklyRate: number }[]).find((h) => h.id === c.inventoryItemId);
          if (hit) bound = { id: hit.id, type: 'INVENTORY', dailyRate: Number(hit.dailyRate) || 0, weeklyRate: Number(hit.weeklyRate) || 0 };
        } catch { /* list price below */ }
        if (!bound) bound = { id: c.inventoryItemId, type: 'INVENTORY', dailyRate: c.dailyRate ?? 0, weeklyRate: 0 };
      } else {
        bound = { id: c.id, type: 'ASSET_CATEGORY', dailyRate: c.dailyRate ?? 0, weeklyRate: 0 };
      }
      const localId = addRowToDept('VEHICLES', { focus: false });
      const b = bound;
      updateItem(localId, {
        description: c.name,
        catalogProductId: b.id,
        catalogType: b.type,
        department: 'VEHICLES',
        rate: pickRate(b, 'DAILY'),
        matchedProduct: { id: b.id, type: b.type, name: c.name },
        matchSource: 'AI',
      });
    } finally {
      setClassPickBusy(false);
    }
  };

  /** Will call, or loaded on one of the reserved vehicles — asked once
   *  the order carries both a vehicle that will hold a unit and a line
   *  that is not a vehicle. Not asked on a warehouse order written FROM
   *  a reservation: that one already knows its truck. */
  const [gearHandoff, setGearHandoff] = useState<{ kind: 'WILL_CALL' } | { kind: 'LOAD_ON'; localId: string } | null>(null);
  const vehicleRows = items.filter((it) => it.department === 'VEHICLES');
  const gearRows = items.filter((it) => it.department !== 'VEHICLES' && (it.description.trim() || it.catalogProductId));
  const holdableVehicleRows = vehicleRows.filter((it) => {
    const k = availKey(it);
    const a = k ? vehicleAvail[k] : null;
    return !!a && a.status === 'ok';
  });
  const gearHandoffAsked = !loadOnAssignmentId && holdableVehicleRows.length > 0 && gearRows.length > 0;
  useEffect(() => {
    if (gearHandoff?.kind === 'LOAD_ON' && !holdableVehicleRows.some((it) => it.localId === gearHandoff.localId)) setGearHandoff(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, vehicleAvail]);

  /** The "which unit" chips under a vehicle line — the Make Reservation
   *  modal's picker, on the order. Free units pick; a buffer unit picks
   *  with the turnaround warning (the human override next-available never
   *  takes on its own); a booked one is shown and refused. */
  const renderUnitPicker = (it: ResolvedItem) => {
    const k = availKey(it);
    const a = k ? vehicleAvail[k] : null;
    if (!a || a.status !== 'ok' || a.units.length === 0) return null;
    const chosen = unitPicks[it.localId] ?? [];
    const open = chosen.length > 0 || !!openUnitPickers[it.localId];
    const max = Math.max(1, it.quantity || 1);
    if (!open) {
      return (
        <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] bg-lt-card/30">
          <span className="text-lt-fg3">Unit: next available on save</span>
          <button
            type="button"
            onClick={() => setOpenUnitPickers((o) => ({ ...o, [it.localId]: true }))}
            className="font-semibold text-lt-fg2 hover:text-lt-fg underline underline-offset-2"
          >
            Pick {max > 1 ? 'specific units' : 'a specific unit'}
          </button>
        </div>
      );
    }
    return (
      <div className="px-3 py-2 bg-lt-card/30 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-lt-fg3">
            Which {max > 1 ? `units (${chosen.length} of ${max})` : 'unit'} — never printed on the quote
          </span>
          <button
            type="button"
            onClick={() => {
              setOpenUnitPickers((o) => ({ ...o, [it.localId]: false }));
              setUnitPicks((prev) => ({ ...prev, [it.localId]: [] }));
            }}
            className="text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg"
          >
            Any unit
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {a.units.map((u) => {
            const picked = chosen.includes(u.assetId);
            const full = !picked && chosen.length >= max;
            const disabled = u.state === 'booked' || full;
            return (
              <button
                key={u.assetId}
                type="button"
                disabled={disabled}
                onClick={() => toggleUnitPick(it, u.assetId)}
                aria-pressed={picked}
                title={
                  u.state === 'booked'
                    ? 'Booked over these dates'
                    : full
                      ? `Only ${max} on this line — unpick one first`
                      : u.state === 'buffer'
                        ? 'Inside the turnaround buffer of another rental — picking it is your call'
                        : `${u.tier.toLowerCase()} tier · free ${it.pickupDate} – ${it.returnDate}`
                }
                className={`text-[12px] px-2 py-1 rounded-md border font-semibold ${
                  picked
                    ? 'bg-amber-600 border-amber-600 text-white'
                    : u.state === 'booked'
                      ? 'bg-lt-inner border-lt-hairline text-lt-fg3 line-through cursor-not-allowed'
                      : u.state === 'buffer'
                        ? 'bg-chip-warn-bg border-chip-warn-fg/30 text-chip-warn-fg hover:opacity-80'
                        : 'bg-lt-card border-lt-hairline text-lt-fg hover:border-amber-600'
                } disabled:opacity-60`}
              >
                {u.unitName}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  /** The waiver as money, for the vehicles section and the total. A fee,
   *  so it lands after discounts like every other fee. */
  const lcdwAmount = useMemo(
    () => (lcdwOn && lcdwFee ? lcdwFee.amount * lcdwEstimate.vehicleDays : 0),
    [lcdwOn, lcdwFee, lcdwEstimate.vehicleDays],
  );
  const orderTotal = useMemo(
    // Fees are added AFTER discounts on purpose: a gear discount
    // discounts gear, not a delivery run. Same order the order page
    // and the quote PDF use.
    () => Math.max(0, discountBreakdown.lineSum - discountBreakdown.total) + feeTotal + lcdwAmount,
    [discountBreakdown, feeTotal, lcdwAmount],
  );

  // Save is allowed when there's at least one line item AND the user
  // has made a definite Job choice:
  //   selected_existing → use the picked Job
  //   creating_new      → create a new Job (needs a company + name)
  // `searching` (default) keeps the save button disabled — explicit
  // choice required to prevent absent-minded duplicates.
  const canCreate =
    items.length > 0 &&
    (job.mode === 'selected_existing'
      ? !!job.jobId
      : job.mode === 'creating_new'
        // '__unknown__' counts: a company we do not have yet must not
        // hold the quote hostage. The resolver stands up a provisional
        // one and Quick Reply asks the client for the real name.
        ? !!selectedClientId && job.name.trim().length > 0
        : false);

  // Three end-of-flow actions share the same Order+lineItems+PDF write,
  // then differ only in what happens after the PDF is generated:
  //   draft    — go straight to the new Order's detail page
  //   preview  — open the PDF in a new tab and then land on detail page
  //   download — trigger a file download via ?download=1 and land on detail page
  // All persist as quoteStatus=DRAFT (schema default). The detail
  // page is the canonical place to iterate; preview/download navigate
  // there afterward so the agent never edits in two places. `send`
  // is the finishing move — same create flow, then lands on the
  // detail page with ?send=1 which auto-opens the existing review
  // gate against the welcome+quote template.
  type CreateAction = 'draft' | 'preview' | 'download' | 'send';

  // ── Job-as-root (step 4): the resolver replaces inline job creation.
  // A typed-but-unresolved job name at save time opens JobResolverModal
  // (ranked existing candidates for this client + dates); the agent
  // picks or creates (createJobFromDraft, status NEW), then the save
  // re-enters with a REAL jobId. pendingActionRef carries the clicked
  // action across the modal; pendingJobExtrasRef carries the wizard's
  // job details (production type, profile, notes, contacts) into the
  // create draft so nothing the rep filled in is lost.
  const [jobResolverOpen, setJobResolverOpen] = useState(false);

  // "Ask client for job name" — sends the existing signed details link
  // (src/lib/intake/detailsToken) rather than inventing a second
  // mechanism. The client's answer comes back as a ClientDetailReply for
  // a human to accept; it never renames anything on its own.
  //
  // The click OPENS THE REVIEW GATE; it does not send (Wes 2026-09-02:
  // "something sent without my ability to review it"). It used to POST
  // straight to the send route from an inline text link — the only
  // client-facing email in HQ that went out unreviewed.
  const [askJobNameTarget, setAskJobNameTarget] = useState<EmailReviewTarget | null>(null);
  const [askJobNameNote, setAskJobNameNote] = useState<string | null>(null);
  const askClientForJobName = () => {
    if (!inquiryId) return;
    const lead = contacts.find((c) => c.include && c.email);
    const toEmail = lead?.email || parsed?.contactEmail || null;
    if (!toEmail) {
      setAskJobNameNote('No client email on this quote yet — add a contact below first.');
      return;
    }
    setAskJobNameNote(null);
    setAskJobNameTarget({
      kind: 'ask-job-name',
      inquiryId,
      toEmail,
      toName: lead?.name || null,
      askForCompany: companyPick.mode === 'creating_new',
    });
  };
  // The lead the Job should be created against — the first included
  // contact with an email. One definition, used by the headless resolve
  // and by the modal, so the two cannot disagree about who the client is.
  const leadContactForResolver = contacts.find((c) => c.include && c.email) ?? null;
  const pendingActionRef = useRef<CreateAction>('draft');
  const pendingJobExtrasRef = useRef<Record<string, unknown> | null>(null);
  // In-flight latch for the whole save. `creating` alone does NOT hold
  // across the headless Job handoff below: that branch fires
  // `void createQuote(...)` and returns, so this call's finally{} clears
  // `creating` about two seconds in while the nested save is still
  // writing the order, its lines, its hold and its quote PDF (~10s). The
  // buttons read "Send quote →" again, a rep who sees nothing happen
  // clicks a second time, and the second run takes the now-resolved-Job
  // path and writes a SECOND order onto the same Job. That is exactly
  // what produced the 2026-09-09 twins: SR-JOB-0332 (S260909-003/-004,
  // 10s apart), SR-JOB-0334 (-008/-009, 6s), SR-JOB-0333 (-005/-006, 8s)
  // — same lines, same totals, one of each an orphan draft.
  //
  // The ref survives the handoff. Only a re-entry that CARRIES a
  // resolved Job (the handoff itself, and the resolver modal's
  // onResolved) may pass it; a second click never can.
  const savingRef = useRef(false);

  const createQuote = async (
    action: CreateAction = 'draft',
    resolvedJob?: { jobId: string; name: string; companyId: string | null; created: boolean },
  ) => {
    if (!canCreate) return;
    if (savingRef.current && !resolvedJob) return;
    savingRef.current = true;
    // Set by the branch that hands this save off to a nested
    // createQuote — the latch must stay CLOSED until that nested call
    // finishes, so the finally{} below leaves both flags alone.
    let handedOff = false;
    setCreating(true);
    try {
      // Empty-row prune. A row is "workspace" when it has neither a
      // typed description nor a catalog binding — those are blanks
      // the rep arrowed past (auto-append leaves trailing empty
      // rows). Discard before save so they never reach the DB / PDF
      // / totals. By emptiness, not position — a blank mid-list gets
      // swept too. Package members are exempt — they always have
      // a description from the template AND a catalog binding so
      // they survive this filter naturally, but the explicit check
      // documents the contract.
      const beforeCount = items.length;
      const cleanItems = items.filter(
        (it) =>
          it.isPackageMember ||
          it.isPackageHeader ||
          it.description.trim().length > 0 ||
          it.catalogProductId != null,
      );
      if (cleanItems.length !== beforeCount) {
        setItems(cleanItems);
      }
      if (cleanItems.length === 0) {
        alert('Add at least one line item before creating the quote.');
        setCreating(false);
        return;
      }
      // The rest of the save flow reads from `items` directly; swap
      // the closure copy here so the prune is in effect for this
      // call.
      const itemsForSave = cleanItems;

      // ── Job-as-root: the Job must be REAL before the Order exists. ──
      // Either the picker already holds an existing Job, or the
      // resolver just returned one (resolvedJob — an existing pick or a
      // Job created via createJobFromDraft). A typed-but-unresolved
      // name opens the resolver and this save re-enters from onResolved.
      const eff =
        resolvedJob ??
        (job.mode === 'selected_existing' && job.jobId
          // realCompanyId, not the raw value: `??` only falls through on
          // null, so a '__unknown__' sentinel would have sailed straight
          // into companyDecision as if it were an id.
          ? { jobId: job.jobId, name: job.name, companyId: job.company?.id ?? realCompanyId(selectedClientId), created: false }
          : null);
      if (!eff) {
        // Materialize Person rows for included contacts first — the
        // resolver's create-new draft attaches them as JobContacts with
        // their parsed roles (createJobFromDraft contacts passthrough).
        // Existing matches and "merge" decisions reuse the existing
        // Person ID; their CRM records are never modified.
        const jobContacts: { personId: string; role: SuggestedJobRole; isPrimary: boolean }[] = [];
        for (const c of contacts.filter((x) => x.include && x.email)) {
          let personId: string | null = null;
          if (c.match_status === 'existing') {
            personId = c.existing_person_id;
          } else if (c.match_status === 'possible_match' && c.decision === 'merge') {
            personId = c.candidate_person_id;
          }
          if (!personId) {
            const trimmed = (c.name || c.email).trim();
            const parts = trimmed.split(/\s+/);
            const firstName = parts[0] || c.email.split('@')[0];
            const lastName = parts.slice(1).join(' ') || '(unknown)';
            // Phone-inquiry quick-add rows have no email-parse provenance
            // (the rep just typed them in). Tag those at create time so
            // the CRM stats strip + capture review can distinguish them
            // from email-derived contacts later.
            const sourceTag = c.source === 'header' && c.confidence === 'high' && !c.existing_person_id && !c.candidate_person_id && (c.title == null)
              ? 'phone_inquiry'
              : 'new_quote';
            try {
              const personRes = await fetch('/api/crm/people', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  firstName,
                  lastName,
                  email: c.email,
                  phone: c.phone || undefined,
                  source: sourceTag,
                }),
              });
              if (personRes.ok) {
                const person = await personRes.json();
                personId = person.id;
              } else {
                console.warn('[orders/new] failed to create person for', c.email);
              }
            } catch (err) {
              console.warn('[orders/new] person create network error:', err);
            }
          }
          if (personId) {
            jobContacts.push({ personId, role: c.role, isPrimary: false });
          }
        }
        pendingJobExtrasRef.current = {
          productionType: newJobProductionType,
          productionTypeProfileId: newJobProductionTypeProfileId,
          notes: newJobNotes.trim() || null,
          contacts: jobContacts,
        };
        pendingActionRef.current = action;

        // ── Only ask when there is something to ask ──────────────────
        //
        // Wes, 2026-08-31: "after I parse an email and go to send the
        // quote, it opens a redundant page, which asks for the client
        // info again (she uploaded it herself) as well as asks about job
        // and company again."
        //
        // The modal's question is "new Job, or does this belong to an
        // existing one?" That is a real question only when there IS a
        // candidate. With none, every field in it is already filled from
        // this page and the rep is re-confirming their own typing — a
        // dialog whose only honest answer is the one it opened with.
        //
        // So resolve HEADLESSLY first and ask needsJobDisambiguation
        // whether there is a question. No candidate — or nothing scoring
        // above the bare "open job at the same company" rung, which
        // fires for every repeat client and whose jobs this page already
        // lists inline — means create the Job from what we hold and go
        // straight on to the order. Real same-job evidence still stops
        // and asks, because the duplicate guard is why the modal exists.
        //
        // Fails OPEN: if the resolve or the create errors, the modal
        // still appears. Silently dropping the rep into no-UI on a
        // network blip would be worse than one extra dialog.
        const leadForJob = leadContactForResolver;
        const resolverContext = {
          companyId: realCompanyId(selectedClientId),
          companyName:
            companyPick.mode === 'creating_new'
              ? companyPick.name
              : companyPick.name || parsed?.clientName || null,
          contactEmail: leadForJob?.email || parsed?.contactEmail || null,
          contactName: leadForJob?.name || null,
          contactPhone: leadForJob?.phone || null,
          jobNameHint: job.name?.trim() || null,
          dates:
            editing.startDate && editing.endDate
              ? { start: editing.startDate, end: editing.endDate }
              : null,
          sourceRef: 'orders:new',
        };

        if (job.name?.trim()) {
          try {
            const rr = await fetch('/api/jobs/resolve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(resolverContext),
            });
            const rd = await rr.json();
            if (rr.ok && rd?.bucket && !needsJobDisambiguation(rd)) {
              const jr = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ...(pendingJobExtrasRef.current ?? {}),
                  name: job.name.trim(),
                  companyId: resolverContext.companyId ?? undefined,
                  companyName: isUnknownCompany(selectedClientId)
                    ? ''
                    : resolverContext.companyName ?? '',
                  companyUnknown: isUnknownCompany(selectedClientId),
                  contactName: resolverContext.contactName ?? '',
                  contactEmail: resolverContext.contactEmail ?? '',
                  contactPhone: resolverContext.contactPhone ?? '',
                  status: 'NEW',
                }),
              });
              // POST /api/jobs answers { job: {...} }, not a bare job —
              // same unwrap the resolver modal does.
              const jd = await jr.json();
              const created = jd?.job;
              if (jr.ok && created?.id) {
                const createdCompanyId = created.company?.id ?? created.companyId ?? null;
                setJob({
                  jobId: created.id,
                  jobCode: created.jobCode,
                  name: created.name,
                  mode: 'selected_existing',
                  company: createdCompanyId
                    ? { id: createdCompanyId, name: created.company?.name || '' }
                    : job.company,
                });
                handedOff = true;
                void createQuote(action, {
                  jobId: created.id,
                  name: created.name,
                  companyId: createdCompanyId,
                  created: true,
                });
                return;
              }
            }
          } catch {
            // fall through to the modal
          }
        }

        setJobResolverOpen(true);
        return; // finally{} clears `creating`; onResolved re-enters
      }
      const existingJobId = eff.jobId;
      // The resolved Job's own company is authoritative — including the
      // provisional one it just minted for an unknown-company lead.
      // Falling back to selectedClientId must never hand a sentinel to
      // the API, so it goes through realCompanyId.
      const companyId = eff.companyId ?? realCompanyId(selectedClientId);
      if (!companyId) {
        alert('Could not resolve a company for this order. Pick one, or choose "I don\'t know the company yet".');
        return;
      }
      if (gearHandoffAsked && !gearHandoff) {
        alert('Say how the gear leaves: will call, or loaded on one of the reserved vehicles. It is the question under the line items.');
        return;
      }

      // ATOMIC create — Order + ALL line items in ONE transaction via
      // /api/orders/from-parse (replaced the old create-order-then-loop-
      // over-line-items sequence, which could leave a half-created order
      // if a mid-loop line failed). Company + Job are already resolved;
      // the Job's contacts were attached by the resolver, so no
      // contactsDecision here. The optional discount stays a separate
      // POST below (its sign convention intentionally left untouched).
      // On any failure the whole thing rolls back — no orphan order.
      const orderDescription =
        eff.name?.trim() || editing.productionName?.trim() || editing.notes || 'Quote from AI extraction';
      const fromParseRes = await fetch('/api/orders/from-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyDecision: { kind: 'existing', companyId },
          jobDecision: { kind: 'existing', jobId: existingJobId },
          contactsDecision: [],
          items: itemsForSave.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            rate: it.rate,
            rateType: it.rateType,
            department: it.department,
            qualifier: it.qualifier || null,
            inventoryItemId: it.catalogType === 'INVENTORY' ? it.catalogProductId : null,
            assetCategoryId: it.catalogType === 'ASSET_CATEGORY' ? it.catalogProductId : null,
            catalogType: it.catalogType ?? null,
            // Included accessories are NOT persisted from the preview.
            // from-parse skips them and lets the kit reconciler build
            // them against the saved order, so the line carries real
            // provenance (autoKitPieceId) and nests under its parent
            // instead of landing flat and unmanaged.
            matchSource: it.matchSource ?? null,
            // The truck(s) the rep named in the Reservation section.
            unitAssignment:
              (unitPicks[it.localId] ?? []).length > 0
                ? { categoryId: holdCategoryIdOf(it), assetIds: unitPicks[it.localId] }
                : null,
            pickupDate: it.pickupDate,
            returnDate: it.returnDate,
            billableDays: it.billableDays,
            claimedDays: it.claimedDays ?? null,
            packageInstanceId: it.packageInstanceId ?? null,
            packageId: it.packageId ?? null,
            isPackageHeader: !!it.isPackageHeader,
            isPackageModified: !!it.isPackageModified,
          })).concat(
            // Fee lines ride the same items array — the server prices
            // them from FeeItem.amount and ignores everything else, so
            // only the id, the count and the (override) rate travel.
            activeFees.map((f) => ({
              description: f.description,
              quantity: f.quantity,
              rate: f.rate,
              feeItemId: f.feeItemId,
            })) as never[],
          ),
          parsed: {
            startDate: editing.startDate || null,
            endDate: editing.endDate || null,
            notes: editing.notes || null,
            // Order description mirrors the old POST /api/orders fallback
            // chain (Job name → typed production name → notes → generic).
            productionName: orderDescription,
          },
          // Will call, or loaded on a reserved truck (Wes 2026-09-12). A
          // warehouse order written from a reservation already knows.
          gearHandoff: loadOnAssignmentId
            ? { kind: 'LOAD_ON', assignmentId: loadOnAssignmentId }
            : gearHandoffAsked && gearHandoff
              ? gearHandoff.kind === 'WILL_CALL'
                ? { kind: 'WILL_CALL' }
                : {
                    kind: 'LOAD_ON',
                    categoryId: holdCategoryIdOf(items.find((it) => it.localId === gearHandoff.localId) ?? ({} as ResolvedItem)),
                  }
              : null,
        }),
      });
      if (!fromParseRes.ok) {
        const err = await fromParseRes.json().catch(() => ({}));
        alert(err.error || 'Failed to create order');
        setCreating(false);
        return;
      }
      const created = (await fromParseRes.json()) as {
        orderId: string;
        unitAssignments?: { assigned: { unitName: string }[]; note: string | null }[];
        gearHandoffNote?: string | null;
      };
      const orderId = created.orderId;
      const order = { id: orderId };
      // Which trucks the save reserved, and which lines got none. The
      // order page shows it per line too, but a van with no unit is the
      // thing to know BEFORE the quote goes out, so it is said here.
      {
        const bound = (created.unitAssignments ?? []).flatMap((u) => u.assigned.map((a) => a.unitName));
        const gaps = (created.unitAssignments ?? []).map((u) => u.note).filter((n): n is string => !!n);
        if (created.gearHandoffNote) gaps.push(created.gearHandoffNote);
        if (gaps.length > 0) {
          alert(`Reserved: ${bound.length ? bound.join(', ') : 'nothing'}\n\n${gaps.join('\n')}`);
        }
      }
      // jobId for downstream inquiry-PATCH — always the resolved Job.
      const jobId: string = existingJobId;

      // Written from a reservation: this order goes out ON that unit.
      // Non-fatal — the order exists either way, and the job page can
      // attach it by hand if this misses.
      if (loadOnAssignmentId) {
        try {
          const r = await fetch(`/api/scheduling/assignments/${loadOnAssignmentId}/order`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId }),
          });
          if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            console.warn('[orders/new] could not attach the order to the unit:', e?.reason || e?.error || r.status);
          }
        } catch (err) {
          console.warn('[orders/new] attach-to-unit failed (non-fatal):', err);
        }
      }

      // Damage waiver — applied by the server's one pricer, which judges
      // eligibility off the saved lines and recalcs totals, so the quote
      // PDF generated below already carries it. Non-fatal: the order
      // exists, and the order page's LCDW prompt can add it by hand.
      if (lcdwOn && lcdwFee) {
        try {
          const r = await fetch(`/api/orders/${orderId}/lcdw`, { method: 'POST' });
          if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            console.warn('[orders/new] LCDW not applied:', e?.error || r.status);
          }
        } catch (err) {
          console.warn('[orders/new] LCDW apply failed (non-fatal):', err);
        }
      }

      // Draft discounts POST through unchanged — same shape as OrderDiscount,
      // so what the draft previewed is what the saved order holds. Sequential
      // rather than parallel: the order-scope one is computed against the
      // department ones on read, and a partial failure should leave a
      // prefix, not a random subset.
      for (const d of discounts) {
        if (!d.value) continue;
        await fetch(`/api/orders/${order.id}/discounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: d.scope,
            departmentKey: d.scope === 'DEPARTMENT' ? d.departmentKey : null,
            type: d.type,
            value: Math.abs(d.value),
            label: d.label || (d.scope === 'DEPARTMENT' ? `${DEPARTMENT_LABEL[d.departmentKey!]} discount` : 'Discount'),
          }),
        });
      }

      // Mark inquiry CONVERTED if we came from one — for BOTH resolver
      // outcomes (2026-08-21 fix: the old eff.created gate left
      // attached-to-existing-Job inquiries NEW forever, phantoms in the
      // queue). New Job → convertedJobId (unique per job); existing Job
      // → convertedOrderId (this order is always fresh, so unique holds).
      if (inquiry) {
        try {
          await fetch(`/api/inquiries/${inquiry.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              eff.created
                ? { status: 'CONVERTED', convertedJobId: jobId }
                : { status: 'CONVERTED', convertedOrderId: orderId },
            ),
          });
        } catch {
          // Non-fatal
        }
      }

      // Generate the client-facing Quote PDF. Block on it so the agent
      // arrives at the order detail page with the PDF already available.
      // Failure is non-fatal — the order is created either way; user can
      // regenerate from the detail page.
      let pdfReady = false;
      try {
        const pdfRes = await fetch(`/api/orders/${order.id}/quote-pdf`, { method: 'POST' });
        pdfReady = pdfRes.ok;
      } catch (err) {
        console.warn('[orders/new] quote PDF generation failed (non-fatal):', err);
      }

      // Fire the action-specific side effect, then navigate. window.open
      // and the download anchor must happen before router.push to avoid
      // browser pop-up blockers (popups need the user-gesture stack).
      // Both routes go through the auth-gated quote-pdf endpoint — the
      // raw Vercel Blob URL is private and returns Forbidden in the
      // browser.
      if (action === 'preview' && pdfReady) {
        window.open(`/api/orders/${order.id}/quote-pdf`, '_blank', 'noopener,noreferrer');
      } else if (action === 'download') {
        const link = document.createElement('a');
        link.href = `/api/orders/${order.id}/quote-pdf?download=1`;
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      router.push(action === 'send' ? `/orders/${order.id}?send=1` : `/orders/${order.id}`);
    } finally {
      // The handoff branch owns the latch until its nested call returns.
      // Clearing it here would re-open the buttons mid-save — the whole
      // bug this guards.
      if (!handedOff) {
        savingRef.current = false;
        setCreating(false);
      }
    }
  };

  // ── The billing week, asked once, before the paper leaves ──────────
  //
  // Wes 2026-09-11: "If a 3d 2d or 1d week isn't selected, it goes out
  // full rate. I feel like we should prompt agents to select rather than
  // risk losing work because our quote comes in so much higher."
  //
  // The three actions that put a NUMBER in front of a client route
  // through here: a downloaded PDF is on its way to somebody as surely
  // as a sent one. "Save Draft" does not — it is how a rep parks a
  // half-priced quote mid-build, and interrupting there would spend the
  // one ask on figures nobody has finished typing. The draft's own send,
  // from the order page, has the per-line week chips.
  //
  // Asked ONCE per builder session (`weekAskedRef`): a second button
  // press is not a second interrogation, and the nested re-entries
  // inside createQuote (the Job handoff, the resolver modal) never come
  // back through this door at all.
  const [weekPromptAction, setWeekPromptAction] = useState<CreateAction | null>(null);
  const weekAskedRef = useRef(false);
  const weekSections: WeekSection[] = useMemo(
    () => weekDecisionsPending(items.map(weekLine), weekDecided),
    [items, weekDecided],
  );
  const requestCreate = (action: CreateAction) => {
    if (action !== 'draft' && !weekAskedRef.current && weekSections.length > 0) {
      setWeekPromptAction(action);
      return;
    }
    void createQuote(action);
  };

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────

  /** One department group, as the Reservation card (VEHICLES) and the
   *  Line Items card (everything else) render it. */
  const renderDeptGroup = (dept: LineItemDepartment, group: ResolvedItem[]) => (
    <DepartmentGroup
      companyId={realCompanyId(selectedClientId)}
      key={dept}
      department={dept}
      rows={group}
      notes={dept === 'VEHICLES' ? vehicleAvailNotes : undefined}
      rowExtras={dept === 'VEHICLES' ? renderUnitPicker : undefined}
      // The waiver shows as a line under the vehicles it covers
      // (Wes 2026-09-10: "I don't see the fees adding to the
      // line above") — derived, not a row the rep edits; the
      // card below is where it is switched on or off.
      derivedLine={
        dept === 'VEHICLES' && lcdwOn && lcdwFee && lcdwEstimate.vehicleDays > 0
          ? {
              label: 'Damage waiver (LCDW)',
              note: `${fmtMoney(lcdwFee.amount)}/day × ${lcdwEstimate.vehicleDays} vehicle-day${lcdwEstimate.vehicleDays === 1 ? '' : 's'} · ${lcdwEstimate.eligible} eligible line${lcdwEstimate.eligible === 1 ? '' : 's'}`,
              rate: lcdwFee.amount,
              amount: lcdwAmount,
            }
          : null
      }
      onChange={updateItem}
      onDelete={removeItem}
      onAdd={() => addRowToDept(dept)}
      onBulkApply={setBulkForDept}
      onApplyWeekCap={applyWeekCapToDept}
      onAddToCatalog={openAddToCatalog}
      onCommit={handleRowCommit}
      onPickPackage={handlePickPackage}
      registerDescriptionRef={registerDescriptionRef}
    />
  );

  // Rendered on BOTH steps — the banner that triggers it exists on both.
  const inquirySourceDrawer = inquiry ? (
    <InquirySourceDrawer
      inquiryId={sourceDrawerOpen ? inquiry.id : null}
      title={inquiry.title}
      onClose={() => setSourceDrawerOpen(false)}
    />
  ) : null;

  // Step 1: Input
  if (!parsed && items.length === 0 && !builderForced) {
    return (
      <div className="bg-lt-page -m-3 md:-m-4 p-4 md:p-6 min-h-[calc(100vh-3rem)]">
        <div className="max-w-3xl mx-auto space-y-4">
        <button onClick={() => router.push('/orders')} className="text-sm text-lt-fg3 hover:text-lt-fg">
          &larr; Back to Orders
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-lt-fg">{loadOn ? 'New Warehouse Order' : 'New Quote'}</h1>
          <p className="text-sm text-lt-fg2 mt-1">
            Paste an email or upload a PDF. AI extracts line items + matches them against the catalog.
          </p>
        </div>
        {(loadOn || loadOnError) && (
          <div className={`rounded-xl border p-3 text-[12px] ${loadOnError ? 'bg-chip-bad-bg text-chip-bad-fg border-chip-bad-fg/30' : 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30'}`}>
            {loadOnError ? (
              <span>{loadOnError} The order will still be created; attach it to the unit from the job page.</span>
            ) : loadOn && (
              <span>
                <span className="font-semibold">Loads on {loadOn.unit.unitName}</span>
                {loadOn.category ? ` (${loadOn.category.name})` : ''} · {loadOn.booking.bookingNumber} · {loadOn.startDate} – {loadOn.endDate}
                {loadOn.job ? ` · ${loadOn.job.jobCode} ${loadOn.job.name}` : ''}
                {loadOn.order ? (
                  <span className="ml-1 font-semibold">— already carries {loadOn.order.orderNumber}; saving here re-points the unit to the new order.</span>
                ) : (
                  <span className="ml-1">— this order will be attached to that vehicle when it is saved.</span>
                )}
              </span>
            )}
          </div>
        )}

        {inquiry && (
          <div className="bg-chip-good-bg text-chip-good-fg border border-chip-good-fg/30 rounded-xl p-3 text-[12px] flex items-center justify-between gap-3">
            <span>
              Created from Inquiry: <span className="font-semibold text-chip-good-fg">{inquiry.title}</span>
              {inquiry.company && <> · <span className="font-semibold text-chip-good-fg">{inquiry.company.name}</span></>}
            </span>
            <button
              type="button"
              onClick={() => setSourceDrawerOpen(true)}
              className="font-semibold text-chip-good-fg hover:opacity-80 hover:underline whitespace-nowrap"
            >
              View original →
            </button>
          </div>
        )}

        <div className="flex gap-1 bg-lt-inner rounded-lg p-0.5 w-fit">
          {(['paste', 'pdf'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setInputMode(m)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium ${
                inputMode === m ? 'bg-white text-lt-fg' : 'text-lt-fg2 hover:text-lt-fg'
              }`}
            >
              {m === 'paste' ? 'Paste Email' : 'Upload PDF'}
            </button>
          ))}
        </div>

        {inputMode === 'paste' ? (
          <div className="space-y-3">
            <textarea
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              placeholder="Paste the client's email or quote request here..."
              rows={14}
              className="w-full px-4 py-3 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-hairline resize-y"
            />
            <button
              onClick={parseEmail}
              disabled={!emailText.trim() || parsing}
              className="w-full py-3 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white font-medium rounded-lg disabled:text-lt-fg3"
            >
              {parsing ? 'AI is parsing…' : 'Parse with AI'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf"
              onChange={(e) => { acceptPdfFile(e.target.files?.[0]); e.target.value = ''; }}
              className="hidden"
            />
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload a PDF — drag and drop or click to browse"
              onClick={() => pdfInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pdfInputRef.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); setPdfDragOver(true); }}
              onDragLeave={() => setPdfDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setPdfDragOver(false); acceptPdfFile(e.dataTransfer.files?.[0]); }}
              className={`w-full rounded-lg border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors ${
                pdfDragOver ? 'border-lt-fg bg-lt-inner' : 'border-lt-hairline bg-lt-card hover:border-lt-fg3'
              }`}
            >
              <svg className="mx-auto mb-3 h-8 w-8 text-lt-fg3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-sm font-medium text-lt-fg">Drag &amp; drop a PDF here — or click to browse</p>
              <p className="mt-1 text-xs text-lt-fg3">You can also paste (&#8984;V) a copied PDF file</p>
            </div>
            {pdfTypeError && <p className="text-xs text-red-700">{pdfTypeError}</p>}
            {pdfFile && (
              <div className="flex items-center justify-between rounded-lg bg-lt-inner px-4 py-2.5">
                <p className="min-w-0 truncate text-sm text-lt-fg">
                  {pdfFile.name} <span className="text-lt-fg3">({(pdfFile.size / 1024).toFixed(0)} KB)</span>
                </p>
                <button
                  onClick={() => { setPdfFile(null); setPdfTypeError(null); }}
                  aria-label="Remove file"
                  className="ml-3 shrink-0 text-lg leading-none text-lt-fg3 hover:text-lt-fg"
                >
                  &times;
                </button>
              </div>
            )}
            <button
              onClick={parsePDF}
              disabled={!pdfFile || parsing}
              className="w-full py-3 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white font-medium rounded-lg disabled:text-lt-fg3"
            >
              {parsing ? 'AI is processing PDF…' : 'Upload & Parse'}
            </button>
            {pdfError !== null && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 space-y-2">
                <p className="text-sm font-medium text-red-800">
                  Couldn&apos;t read this PDF — try Paste Email or manual entry
                </p>
                {pdfError && <p className="text-xs text-red-700">{pdfError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setPdfError(null); setInputMode('paste'); }}
                    className="px-3 py-1.5 rounded-md bg-white border border-red-300 text-xs font-medium text-red-800 hover:bg-red-100"
                  >
                    Paste Email
                  </button>
                  <button
                    onClick={() => { setPdfError(null); addBlankItem(); }}
                    className="px-3 py-1.5 rounded-md bg-white border border-red-300 text-xs font-medium text-red-800 hover:bg-red-100"
                  >
                    Enter manually
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button onClick={addBlankItem} className="text-xs text-lt-fg3 hover:text-lt-fg2 underline">
          Or skip parsing and add line items manually
        </button>
        </div>
        {inquirySourceDrawer}
      </div>
    );
  }

  // Step 2: Review
  return (
    <div className="bg-lt-page -m-3 md:-m-4 p-4 md:p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-5xl mx-auto space-y-4">
      <button onClick={() => { setParsed(null); setItems([]); setBuilderForced(false); }} className="text-sm text-lt-fg3 hover:text-lt-fg">
        &larr; Start Over
      </button>
      {inquiry && (
        <div className="text-[11.5px] text-lt-fg3">
          Created from Inquiry: <span className="text-lt-fg3 font-medium">{inquiry.title}</span>
          {' · '}
          <button
            type="button"
            onClick={() => setSourceDrawerOpen(true)}
            className="text-lt-fg3 hover:text-lt-fg hover:underline"
          >
            View original →
          </button>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold text-lt-fg">
          {loadOn ? 'Review Warehouse Order' : builderForced && !parsed ? 'New Order / Rez' : 'Review Quote'}
        </h1>
        <p className="text-sm text-lt-fg2 mt-1">
          {builderForced && !parsed
            ? 'Reserve the vehicles at the top, then add the gear that goes out on them. Everything is held and priced when you save.'
            : 'Adjust each line item. Departments, rates, and rate-types are editable per row.'}
        </p>
      </div>
        {(loadOn || loadOnError) && (
        <div className={`rounded-xl border p-3 text-[12px] ${loadOnError ? 'bg-chip-bad-bg text-chip-bad-fg border-chip-bad-fg/30' : 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30'}`}>
          {loadOnError ? (
            <span>{loadOnError} The order will still be created; attach it to the unit from the job page.</span>
          ) : loadOn && (
            <span>
              <span className="font-semibold">Loads on {loadOn.unit.unitName}</span>
              {loadOn.category ? ` (${loadOn.category.name})` : ''} · {loadOn.booking.bookingNumber} · {loadOn.startDate} – {loadOn.endDate}
              {loadOn.job ? ` · ${loadOn.job.jobCode} ${loadOn.job.name}` : ''}
              {loadOn.order ? (
                <span className="ml-1 font-semibold">— already carries {loadOn.order.orderNumber}; saving here re-points the unit to the new order.</span>
              ) : (
                <span className="ml-1">— this order will be attached to that vehicle when it is saved.</span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Recognized lead (STEP 1A) — promotes the inbound sender from
          the secondary contacts list to the form anchor. Three states
          honored:
            existing       → green strip with live history counts.
            possible_match → amber "Is this X?" prompt with confirm /
                             override / not-this-person buttons. Does
                             NOT auto-anchor — sender could be an
                             assistant or a shared address.
            new            → quiet hint; the existing PeopleSection
                             quick-add stays the primary path. */}
      {leadContact && leadContact.status === 'existing' && (
        <div className="bg-chip-good-bg border border-chip-good-fg/30 rounded-xl p-4 space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-chip-good-fg font-bold">Recognized</div>
              <div className="text-base font-semibold text-lt-fg mt-0.5">
                {leadPersonHistory?.person.name || leadContact.contact.name}
              </div>
              <div className="text-xs text-lt-fg2">
                {leadContact.contact.email}
                {leadPersonHistory?.person.rawTitle && <span> · {leadPersonHistory.person.rawTitle}</span>}
                {!leadPersonHistory?.person.rawTitle && leadContact.contact.title && <span> · {leadContact.contact.title}</span>}
              </div>
            </div>
            {leadHistoryLoading ? (
              <div className="text-[11px] text-lt-fg3">loading history…</div>
            ) : leadPersonHistory ? (
              <div className="text-[11px] text-lt-fg2 text-right">
                <div>
                  <span className="font-mono font-semibold text-chip-good-fg">{leadPersonHistory.person.counts.priorOrders}</span> prior orders
                </div>
                {leadPersonHistory.person.lastKnownProject && (
                  <div className="italic">last: {leadPersonHistory.person.lastKnownProject}</div>
                )}
                {leadPersonHistory.recentOrders[0] && (
                  <div className="text-lt-fg3">
                    most recent: {leadPersonHistory.recentOrders[0].orderNumber}
                    {leadPersonHistory.recentOrders[0].companyName && ` · ${leadPersonHistory.recentOrders[0].companyName}`}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          {leadPersonHistory && leadPersonHistory.suggestedCompanies.length > 0 && clientCandidates.length === 0 && !selectedClientId && (
            <div className="text-[11px] text-lt-fg2 pt-2 border-t border-chip-good-fg/30">
              <span className="text-lt-fg3">Suggest as Client Company:</span>{' '}
              {leadPersonHistory.suggestedCompanies.slice(0, 4).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedClientId(s.id)}
                  className="inline-flex items-center px-2 py-0.5 mr-1 mb-1 rounded border border-chip-good-fg/40 hover:bg-chip-good-fg/10 text-lt-fg"
                  title={s.reason}
                >
                  {s.name}
                  <span className="ml-1 text-lt-fg3 text-[10px]">{s.reason}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {leadContact && leadContact.status === 'possible_match' && (
        <div className="bg-chip-warn-bg border border-chip-warn-fg/30 rounded-xl p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-chip-warn-fg font-bold">Possible match</div>
          <div className="text-sm text-lt-fg">
            Is this <span className="font-semibold">{leadContact.contact.name}</span>?
            <span className="text-xs text-lt-fg2 ml-2">
              ({leadContact.contact.email}) — same first + last name as someone we know.
              The sender could be them, or an assistant on their behalf. Your call.
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const cid = leadContact.contact.candidate_person_id;
                if (cid) setConfirmedLeadPersonId(cid);
              }}
              className="text-xs px-3 py-1 bg-chip-good-fg text-white rounded hover:opacity-90"
            >
              Confirm — it's them
            </button>
            <button
              type="button"
              onClick={() => {
                // Mark this row as a new-person decision so it falls
                // out of the lead bucket and lands in the existing
                // PeopleSection's quick-add flow.
                setContacts((prev) => prev.map((c) =>
                  c === leadContact.contact ? { ...c, decision: 'create_new', match_status: 'new', candidate_person_id: null } : c,
                ));
              }}
              className="text-xs px-3 py-1 border border-lt-hairline rounded hover:bg-lt-card text-lt-fg2"
            >
              Different person — create new
            </button>
          </div>
        </div>
      )}
      {leadContact && leadContact.status === 'new' && (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-3 text-xs text-lt-fg2">
          New contact: <span className="font-semibold text-lt-fg">{leadContact.contact.name || leadContact.contact.email}</span>
          {leadContact.contact.email && <span className="text-lt-fg3"> · {leadContact.contact.email}</span>}
          <span className="text-lt-fg3 ml-2">— will be created with the order. Edit in the contacts panel below.</span>
        </div>
      )}

      {/* Header context — editable client/dates extracted by the AI. */}
      {(
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-3">
          <div>
            <label className="block text-xs text-lt-fg3 mb-1">Client Company</label>
            {/* (STEP 1B) Type-ahead with create + normalized-key dupe
                guard. The picker ranks the recognized lead's
                recently-touched companies first via recentCompanyIds.
                The same companyNameKey() runs server-side at create
                time so a "Rema Films" + existing "Rema Films LLC"
                collision surfaces before a dupe lands. */}
            {inquiry?.company ? (
              <div className="text-sm text-lt-fg2">{inquiry.company.name}</div>
            ) : (
              <div className="space-y-2">
                {/* Name-evidence candidates from the parsed email
                    (subject/body/signature company mentions). Tappable
                    only — evidence-only prefill means even a single
                    match waits for the rep's tap. */}
                {clientCandidates.length > 0 && companyPick.mode === 'searching' && (
                  <div className="space-y-1">
                    <div className="text-[11px] text-lt-fg3">Matched from email:</div>
                    <div className="flex flex-wrap gap-1">
                      {clientCandidates.slice(0, 5).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setCompanyPick({
                            companyId: c.id, name: c.name, mode: 'selected_existing',
                            tier: c.tier, coiOnFile: c.coiOnFile,
                          })}
                          title={`name match: "${parsed?.clientName ?? ''}"`}
                          className="text-xs px-2 py-1 bg-lt-inner border border-chip-good-fg/40 rounded-lg text-lt-fg hover:border-chip-good-fg"
                        >
                          {c.name}
                          <span className="ml-1 text-lt-fg3 text-[10px]">name match</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Lead's suggested companies as one-tap picks ABOVE
                    the picker (STEP 1A integration). The picker
                    itself ranks the same companies first via
                    recentCompanyIds — these buttons are the
                    can't-miss-it variant for the case where the rep
                    hasn't typed anything yet. */}
                {leadPersonHistory && leadPersonHistory.suggestedCompanies.length > 0 && companyPick.mode === 'searching' && (
                  <div className="space-y-1">
                    <div className="text-[11px] text-lt-fg3">
                      {leadPersonHistory.person.name.split(' ')[0] || 'Their'} known companies:
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {leadPersonHistory.suggestedCompanies.slice(0, 5).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setCompanyPick({
                            companyId: s.id, name: s.name, mode: 'selected_existing',
                            tier: s.tier, coiOnFile: null,
                          })}
                          title={s.reason}
                          className="text-xs px-2 py-1 bg-lt-inner border border-lt-hairline rounded-lg text-lt-fg hover:border-chip-good-fg/50"
                        >
                          {s.name}
                          <span className="ml-1 text-lt-fg3 text-[10px]">{s.reason}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <CompanyPicker
                  value={companyPick}
                  onChange={setCompanyPick}
                  recentCompanyIds={leadPersonHistory?.suggestedCompanies.map((c) => c.id) ?? []}
                  placeholder={parsed?.clientName ? `e.g. ${parsed.clientName}` : 'Search companies or type a new name…'}
                />
                {parsed?.clientName && companyPick.mode === 'searching' && (
                  <p className="text-xs text-lt-fg3">AI extracted: <span className="text-lt-fg2">{parsed.clientName}</span></p>
                )}
              </div>
            )}
          </div>
          {/* Unified Job control — replaces the prior free-text
              "Job Name" input. Typing searches existing client Jobs;
              no match → "Create new job: '<typed>'." The picker is
              seeded with the inquiry/parsed title via the seed-sync
              effect above. Recommendations + new-job-details reveal
              live here so there's one place to think about the Job. */}
          <div>
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
              <label className="block text-xs text-lt-fg3">Job</label>
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-[11px] text-lt-fg3">
                  {candidateJobs.length > 0
                    ? `${candidateJobs.length} existing Job${candidateJobs.length === 1 ? '' : 's'} for this client — pick one, or type a new name.`
                    : realCompanyId(selectedClientId)
                      ? 'No matching Jobs — a typed name opens the Job check on save (pick or create there).'
                      : 'Pick a Client Company first to surface matching Jobs.'}
                </p>
                {/* The alternative to asking is what the book already
                    shows: jobs called "TBD", "QUOTE" and "New Job" —
                    placeholders invented at quote time that nobody goes
                    back and fixes, and that make every later search
                    worse. Only offered when the name is actually
                    missing; once something is typed, asking is noise. */}
                {inquiryId && !job.name?.trim() && (
                  <button
                    type="button"
                    onClick={askClientForJobName}
                    title="Review and send the client a one-tap link asking what to call this production"
                    className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 underline underline-offset-2"
                  >
                    Ask client for job name…
                  </button>
                )}
              </div>
            </div>
            {askJobNameNote && (
              <p className="text-[11px] text-chip-good-fg mb-1">{askJobNameNote}</p>
            )}
            <JobPicker
              value={job}
              onChange={setJob}
              companyId={realCompanyId(selectedClientId)}
              placeholder={
                job.name
                  ? `Search jobs by name or code…`
                  : 'Search by job name or code, or type a new name…'
              }
            />

            {/* Job-as-root: save-time resolver. Ranked candidates for
                this client + dates; the agent picks or creates, then
                the save continues automatically with the real jobId. */}
            {/* Promote-a-custom-line modal — seeded from the row whose
                "+ add" chip opened it; on create the line binds to the
                new catalog item. */}
            {addCatalogForId && (() => {
              const row = items.find((i) => i.localId === addCatalogForId);
              return (
                <AddItemModal
                  open
                  onClose={() => setAddCatalogForId(null)}
                  onCreated={handleCatalogCreated}
                  categories={catalogMeta?.categories ?? []}
                  locations={catalogMeta?.locations ?? []}
                  defaultDescription={row?.description || undefined}
                  defaultDailyRate={row?.rate && row.rate > 0 ? row.rate : undefined}
                />
              );
            })()}
            {jobResolverOpen && (
              <JobResolverModal
                // Carry the rep's answer into the modal so they are not
                // asked the same question twice.
                seedCompanyUnknown={companyPick.mode === 'unknown'}
                context={{
                  companyId: realCompanyId(selectedClientId),
                  companyName:
                    companyPick.mode === 'creating_new'
                      ? companyPick.name
                      : companyPick.name || parsed?.clientName || null,
                  // Name and phone as well as the email. The page already
                  // has the lead — often because the CLIENT filled it in —
                  // and the modal was re-asking for all three because only
                  // the email was ever handed over.
                  contactEmail: leadContactForResolver?.email || parsed?.contactEmail || null,
                  contactName: leadContactForResolver?.name || null,
                  contactPhone: leadContactForResolver?.phone || null,
                  jobNameHint: job.name?.trim() || null,
                  dates: editing.startDate && editing.endDate ? { start: editing.startDate, end: editing.endDate } : null,
                  sourceRef: 'orders:new',
                }}
                draftExtras={pendingJobExtrasRef.current ?? undefined}
                onResolved={(r) => {
                  setJobResolverOpen(false);
                  setJob({
                    jobId: r.id,
                    jobCode: r.jobCode,
                    name: r.name,
                    mode: 'selected_existing',
                    company: r.companyId ? { id: r.companyId, name: r.companyName || '' } : job.company,
                  });
                  void createQuote(pendingActionRef.current, {
                    jobId: r.id, name: r.name, companyId: r.companyId ?? null, created: r.created,
                  });
                }}
                onClose={() => setJobResolverOpen(false)}
              />
            )}

            {/* The job-name ask, behind the same review gate every other
                client email uses: the rep reads it, edits it, and sends. */}
            <EmailReviewModal
              target={askJobNameTarget}
              onClose={() => setAskJobNameTarget(null)}
              onSent={(info) => {
                setAskJobNameTarget(null);
                setAskJobNameNote(`Asked ${info.recipient} — their answer lands on this inquiry.`);
              }}
            />

            {/* Recommendations: list of this client's open Jobs, only
                shown while nothing has been picked/typed yet. Clicking
                one links the existing Job into the picker. */}
            {candidateJobs.length > 0 && job.mode === 'searching' && (
              <div className="mt-2 space-y-1.5">
                {[...candidateJobs]
                  .sort((a, b) => {
                    const aT = a.startDate ? new Date(a.startDate).getTime() : 0;
                    const bT = b.startDate ? new Date(b.startDate).getTime() : 0;
                    return bT - aT;
                  })
                  .map((j, idx) => {
                    const orders = j._count?.orders ?? 0;
                    const recommended = idx === 0;
                    return (
                      <button
                        key={j.id}
                        type="button"
                        onClick={() =>
                          setJob({
                            jobId: j.id,
                            jobCode: j.jobCode,
                            name: j.name,
                            mode: 'selected_existing',
                            company: j.company,
                          })
                        }
                        className="w-full text-left rounded-lg border px-3 py-2 bg-lt-card/60 border-lt-hairline hover:bg-lt-inner/60 transition-colors flex items-start gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-[13px] font-semibold text-lt-fg truncate">
                              [{j.jobCode}] {j.name}
                            </div>
                            {recommended && (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-chip-good-bg text-chip-good-fg border border-chip-good-fg/30">
                                Recommended
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-lt-fg3 mt-0.5">
                            {j.startDate && (
                              <>
                                {new Date(j.startDate).toLocaleDateString('en-US', { timeZone: 'UTC' })}
                                {j.endDate ? ` → ${new Date(j.endDate).toLocaleDateString('en-US', { timeZone: 'UTC' })}` : ''}
                              </>
                            )}
                            {j.startDate && orders > 0 && ' · '}
                            {orders > 0 && `${orders} existing order${orders === 1 ? '' : 's'}`}
                            {(!j.startDate && orders === 0) && 'no dates / no orders yet'}
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}

            {/* New-job details reveal — only shown while the picker is
                in creating_new mode. Production type is the only
                routing field the agent picks; the tier-bearing
                ProductionTypeProfile id is auto-derived above and
                hangs off the new Job on save without an agent-facing
                dropdown. Notes round out what the form collects. */}
            {job.mode === 'creating_new' && (
              <div className="mt-2 rounded-lg border border-chip-warn-fg/30 bg-chip-warn-bg p-3 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-lt-fg font-bold">
                  New job details
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-lt-fg3 mb-1">Production type</label>
                  <select
                    value={newJobProductionType}
                    onChange={(e) => setNewJobProductionType(e.target.value as ProductionType)}
                    className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-[12px] text-lt-fg"
                  >
                    {PRODUCTION_TYPES.map((pt) => (
                      <option key={pt} value={pt}>{PRODUCTION_TYPE_LABEL[pt]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-lt-fg3 mb-1">Notes (optional)</label>
                  <textarea
                    value={newJobNotes}
                    onChange={(e) => setNewJobNotes(e.target.value)}
                    rows={2}
                    placeholder="Context, client preferences, deal notes…"
                    className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-[12px] text-lt-fg resize-y"
                  />
                </div>
                <p className="text-[10px] text-lt-fg3">
                  Job + Order are created together when you Save Draft — nothing is written until then.
                </p>
              </div>
            )}
          </div>

        </div>
      )}

      {/* Job control + recommendations + new-job details now live
          inline in the Client Company card above — no separate
          "Job for this Quote" section. */}

      {/* People on this thread (AI-extracted contacts, human review) */}
      <PeopleSection contacts={contacts} setContacts={setContacts} />

      {/* Reservation — the VEHICLES group, promoted to the top of the
          order (Wes 2026-09-12). See the section's state above. */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-bold text-lt-fg">Reservation ({vehicleRows.length})</h2>
            <p className="text-xs text-lt-fg2 mt-0.5">
              The vehicles on this order. Each is held on save and a unit is bound then — next available, or the one you pick. Unit numbers never print on the quote.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-lt-fg2">
            <span>{vehicleRows.length === 0 ? '+ Reserve a vehicle' : '+ Add another vehicle'}</span>
            <select
              value=""
              disabled={classPickBusy || fleetClasses.length === 0}
              onChange={(e) => { const v = e.target.value; if (v) void reserveClass(v); }}
              className="bg-lt-inner border border-lt-hairline rounded-lg px-2 py-1.5 text-xs text-lt-fg min-w-[220px] disabled:opacity-60"
              title="Adds a vehicle line bound to this fleet class — held on save"
            >
              <option value="">{fleetClasses.length === 0 ? 'Loading fleet…' : 'Pick a class…'}</option>
              {[...fleetClasses].sort((a, b) => b.recentDemand - a.recentDemand || a.name.localeCompare(b.name)).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.code ? ` (${c.code})` : ''} · {c.totalUnits} unit{c.totalUnits === 1 ? '' : 's'}{c.dailyRate != null ? ` · ${fmtMoney(c.dailyRate)}/day` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* The rental window. This used to sit in the Client Company /
            Job card above, where it read as the JOB's dates — and a job
            has no dates of its own (Wes 2026-09-02; the columns were
            dropped 2026-08-31). It belongs here because this is what it
            actually does: it fills in every line's pickup and return,
            leaving any line you have dated by hand alone. */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-lt-hairline bg-lt-inner/40 p-3">
          <div className="col-span-2 text-xs text-lt-fg3">
            Rental window &mdash; fills in every line below. A line you dated yourself stays put.
          </div>
          <div>
            <label className="block text-xs text-lt-fg3 mb-1">Pickup Date</label>
            <input
              type="date" value={editing.startDate || ''}
              onChange={(e) => updateQuoteDate('startDate', e.target.value)}
              className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
            />
          </div>
          <div>
            <label className="block text-xs text-lt-fg3 mb-1">Return Date</label>
            <input
              type="date" value={editing.endDate || ''}
              onChange={(e) => updateQuoteDate('endDate', e.target.value)}
              className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
            />
          </div>
        </div>
        {vehicleRows.length === 0 ? (
          <div className="text-xs text-lt-fg3 text-center py-4">
            No vehicles reserved. Pick a class above, or type one on a line below and the catalog match will move it here.
          </div>
        ) : (
          renderDeptGroup('VEHICLES', vehicleRows)
        )}
      </div>

      {/* Line items — everything that is not a vehicle */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-lt-fg">Line Items ({items.length - vehicleRows.length})</h2>
          <button onClick={addBlankItem} className="text-xs font-semibold text-lt-fg2 hover:text-lt-fg">
            + Add line manually
          </button>
        </div>
        {items.length - vehicleRows.length === 0 ? (
          <div className="text-xs text-lt-fg3 text-center py-6">No line items.</div>
        ) : (
          DEPARTMENTS.filter((d) => d !== 'VEHICLES').map((dept) => {
            const group = items.filter((it) => it.department === dept);
            if (group.length === 0) return null;
            return renderDeptGroup(dept, group);
          })
        )}

        {/* Will call, or loaded on a reserved truck — asked only when
            there is a truck to load and gear to load on it. */}
        {gearHandoffAsked && (
          <div className={`rounded-lg border p-3 space-y-2 ${gearHandoff ? 'border-lt-hairline bg-lt-inner/40' : 'border-chip-warn-fg/40 bg-chip-warn-bg'}`}>
            <div className={`text-xs font-semibold ${gearHandoff ? 'text-lt-fg' : 'text-chip-warn-fg'}`}>
              How does the gear leave?
              {!gearHandoff && <span className="font-normal"> — needed before this order can be saved.</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={`flex items-center gap-2 text-[12px] rounded-md border px-2.5 py-1.5 cursor-pointer ${gearHandoff?.kind === 'WILL_CALL' ? 'bg-amber-600 border-amber-600 text-white' : 'bg-lt-card border-lt-hairline text-lt-fg hover:border-amber-600'}`}>
                <input type="radio" name="gear-handoff" className="sr-only" checked={gearHandoff?.kind === 'WILL_CALL'} onChange={() => setGearHandoff({ kind: 'WILL_CALL' })} />
                Will call — the client picks it up at the warehouse
              </label>
              {holdableVehicleRows.map((it) => (
                <label
                  key={it.localId}
                  className={`flex items-center gap-2 text-[12px] rounded-md border px-2.5 py-1.5 cursor-pointer ${gearHandoff?.kind === 'LOAD_ON' && gearHandoff.localId === it.localId ? 'bg-amber-600 border-amber-600 text-white' : 'bg-lt-card border-lt-hairline text-lt-fg hover:border-amber-600'}`}
                >
                  <input type="radio" name="gear-handoff" className="sr-only" checked={gearHandoff?.kind === 'LOAD_ON' && gearHandoff.localId === it.localId} onChange={() => setGearHandoff({ kind: 'LOAD_ON', localId: it.localId })} />
                  Loaded on {it.description || 'the vehicle'}{it.quantity > 1 ? ` (×${it.quantity} — first unit bound)` : ''}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Fees — the delivery/pickup runs a quote has to price up front
          (Wes 2026-08-31). Catalog-driven: the amount comes from
          /admin/fees and is editable here as an override the server
          re-resolves and audits. */}
      {/* Damage waiver — on the quote unless the rep takes it off (Wes
          2026-09-10). Shown whenever the fee exists in the catalog and the
          quote has a vehicle line; the server decides eligibility per
          vehicle when the order is saved. */}
      {lcdwFee && lcdwEstimate.vehicleDays + lcdwEstimate.excluded > 0 && (
        <div className={`border rounded-xl p-4 ${lcdwOn ? 'bg-chip-good-bg border-chip-good-fg/30' : 'bg-lt-card border-lt-hairline'}`}>
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={lcdwOn}
              onChange={(e) => setLcdwOn(e.target.checked)}
              className="accent-amber-600 mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-lt-fg">
                Damage waiver (LCDW) · {fmtMoney(lcdwFee.amount)}/day per vehicle
                {lcdwOn && lcdwEstimate.vehicleDays > 0 && (
                  <span className="ml-2 font-mono text-xs text-lt-fg2">est. +{fmtMoney(lcdwFee.amount * lcdwEstimate.vehicleDays)}</span>
                )}
              </span>
              <span className="block text-[12px] text-lt-fg2 mt-0.5">
                {lcdwEstimate.allExcluded
                  ? 'None of the vehicles on this quote are eligible — nothing will be added.'
                  : lcdwOn
                    ? `Goes on the quote for ${lcdwEstimate.eligible} eligible vehicle line${lcdwEstimate.eligible === 1 ? '' : 's'} (${lcdwEstimate.vehicleDays} vehicle-day${lcdwEstimate.vehicleDays === 1 ? '' : 's'}). The client can decline it in the portal; untick to leave it off.`
                    : 'Left off the quote. The order page can add it later.'}
                {lcdwEstimate.excluded > 0 && !lcdwEstimate.allExcluded && ` ${lcdwEstimate.excluded} vehicle line${lcdwEstimate.excluded === 1 ? ' is' : 's are'} not eligible and won\u2019t be charged.`}
              </span>
            </span>
          </label>
        </div>
      )}
      {feeCatalog && feeCatalog.length > 0 && (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-wider text-lt-fg3 font-bold">Fees (optional)</div>
            {feeTotal > 0 && (
              <div className="text-xs text-lt-fg2 font-mono">+{fmtMoney(feeTotal)}</div>
            )}
          </div>
          <div className="space-y-2">
            {feeCatalog.map((f) => {
              const sel = feeSelections[f.code] ?? { on: false, rate: f.catalogAmount, quantity: 1 };
              const overridden = sel.on && sel.rate !== f.catalogAmount;
              return (
                <div key={f.code} className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer select-none min-w-[190px]">
                    <input
                      type="checkbox"
                      checked={sel.on}
                      onChange={(e) =>
                        setFeeSelections((prev) => ({
                          ...prev,
                          [f.code]: { ...sel, on: e.target.checked },
                        }))
                      }
                      className="accent-amber-600"
                    />
                    <span className="text-sm text-lt-fg font-medium">{f.name}</span>
                  </label>
                  {sel.on && (
                    <>
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-lt-fg3">Qty</span>
                        <IntegerInput
                          value={sel.quantity}
                          onChange={(next) =>
                            setFeeSelections((prev) => ({
                              ...prev,
                              [f.code]: { ...sel, quantity: Math.max(1, next) },
                            }))
                          }
                          min={1}
                          ariaLabel={`${f.name} quantity`}
                          className="w-14 bg-lt-card border border-lt-hairline rounded px-2 py-1 text-sm tabular-nums text-lt-fg text-center"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-lt-fg3">Each</span>
                        <CurrencyInput
                          value={sel.rate}
                          onChange={(next) =>
                            setFeeSelections((prev) => ({
                              ...prev,
                              [f.code]: { ...sel, rate: next },
                            }))
                          }
                          min={0}
                          className="w-28"
                          inputClassName="px-2 py-1 bg-lt-card border border-lt-hairline rounded text-sm text-lt-fg text-right font-mono"
                          ariaLabel={`${f.name} amount`}
                        />
                      </div>
                      <div className="ml-auto text-sm font-bold tabular-nums text-chip-good-fg">
                        {fmtMoney(sel.quantity * sel.rate)}
                      </div>
                    </>
                  )}
                  {!sel.on && (
                    <span className="text-[11px] text-lt-fg3 font-mono">{fmtMoney(f.catalogAmount)}</span>
                  )}
                  {overridden && (
                    <span
                      className="basis-full text-[11px] text-amber-700"
                      title="The server records this as a rate override against the catalog price"
                    >
                      Overriding the catalog price of {fmtMoney(f.catalogAmount)}.
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Discounts — % or $, whole order or one category. */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] uppercase tracking-wider text-lt-fg3 font-bold">Discounts (optional)</div>
          {discountBreakdown.total > 0 && (
            <div className="text-xs text-lt-fg2 font-mono">−${discountBreakdown.total.toFixed(2)}</div>
          )}
        </div>

        {discounts.length === 0 && (
          <div className="text-xs text-lt-fg3">No discounts. Add one for the whole order or a single category.</div>
        )}

        {discounts.map((d, i) => {
          const row = discountBreakdown.rows[i];
          const patch = (next: Partial<DraftDiscount>) =>
            setDiscounts((prev) => prev.map((x) => (x.localId === d.localId ? { ...x, ...next } : x)));
          // Only departments that actually have lines are worth discounting.
          const availableDepts = DEPARTMENTS.filter((dep) => (departmentSubtotals[dep] ?? 0) > 0);
          return (
            <div key={d.localId} className="grid grid-cols-[minmax(0,1.1fr)_auto_minmax(0,0.7fr)_minmax(0,1.2fr)_auto] gap-2 items-center">
              <select
                value={d.scope === 'ORDER' ? 'ORDER' : (d.departmentKey ?? '')}
                onChange={(e) => {
                  const v = e.target.value;
                  patch(v === 'ORDER'
                    ? { scope: 'ORDER', departmentKey: null }
                    : { scope: 'DEPARTMENT', departmentKey: v as LineItemDepartment });
                }}
                className="px-2 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
              >
                <option value="ORDER">Whole order</option>
                {availableDepts.map((dep) => (
                  <option key={dep} value={dep}>{DEPARTMENT_LABEL[dep]}</option>
                ))}
              </select>

              <div className="flex border border-lt-hairline rounded-lg overflow-hidden text-sm">
                {(['PERCENT', 'FIXED'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => patch({ type: t })}
                    className={`px-2.5 py-2 ${d.type === t ? 'bg-lt-fg text-white' : 'bg-lt-inner text-lt-fg2'}`}
                  >
                    {t === 'PERCENT' ? '%' : '$'}
                  </button>
                ))}
              </div>

              {d.type === 'PERCENT' ? (
                <input
                  type="text"
                  inputMode="decimal"
                  value={d.value === 0 ? '' : String(d.value)}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value.replace(/[^\d.]/g, ''));
                    patch({ value: Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0 });
                  }}
                  placeholder="10"
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg font-mono"
                />
              ) : (
                <CurrencyInput
                  value={d.value}
                  onChange={(next) => patch({ value: Math.abs(next) })}
                  min={0}
                  inputClassName="px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg font-mono"
                  ariaLabel="Discount amount"
                />
              )}

              <input
                type="text"
                value={d.label}
                onChange={(e) => patch({ label: e.target.value })}
                placeholder={d.scope === 'DEPARTMENT' && d.departmentKey ? `${DEPARTMENT_LABEL[d.departmentKey]} courtesy` : 'e.g. Loyalty discount'}
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
              />

              <div className="flex items-center gap-2">
                <span className="text-xs text-lt-fg3 font-mono w-20 text-right">
                  {row && row.applied > 0 ? `−$${row.applied.toFixed(2)}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setDiscounts((prev) => prev.filter((x) => x.localId !== d.localId))}
                  className="px-2 py-1 text-lt-fg3 hover:text-rose-600"
                  title="Remove discount"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() =>
            setDiscounts((prev) => [
              ...prev,
              {
                localId: `d${prev.length}-${prev.reduce((a, x) => a + x.localId.length, 0)}`,
                scope: 'ORDER', departmentKey: null, type: 'PERCENT', value: 0, label: '',
              },
            ])
          }
          className="text-xs font-semibold text-amber-600 hover:text-amber-500"
        >
          + Add discount
        </button>
      </div>

      {/* Footer actions */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span className="text-lt-fg3 uppercase tracking-wider text-xs font-semibold">Subtotal</span>
          <span className="ml-3 tabular-nums text-lt-fg text-2xl font-bold">{fmtMoney(orderTotal)}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setParsed(null); setItems([]); setBuilderForced(false); }}
            className="px-4 py-2 text-sm text-lt-fg2 hover:text-lt-fg"
          >
            Cancel
          </button>
          <button
            onClick={() => requestCreate('download')}
            disabled={!canCreate || creating}
            className="px-4 py-2 bg-lt-inner hover:bg-lt-hairline disabled:opacity-50 text-lt-fg text-sm font-semibold rounded-lg"
            title="Save as draft and download the PDF"
          >
            {creating ? 'Saving…' : 'Download PDF'}
          </button>
          <button
            onClick={() => requestCreate('preview')}
            disabled={!canCreate || creating}
            className="px-4 py-2 bg-lt-inner hover:bg-lt-hairline disabled:opacity-50 text-lt-fg text-sm font-semibold rounded-lg"
            title="Save as draft and open the PDF in a new tab"
          >
            {creating ? 'Saving…' : 'Preview PDF'}
          </button>
          <button
            onClick={() => requestCreate('draft')}
            disabled={!canCreate || creating}
            className="px-5 py-2 bg-lt-inner hover:bg-lt-hairline disabled:opacity-50 text-lt-fg text-sm font-semibold rounded-lg"
            title="Save as draft and open the order detail page"
          >
            {creating ? 'Saving Draft…' : 'Save Draft'}
          </button>
          <button
            onClick={() => requestCreate('send')}
            disabled={!canCreate || creating}
            className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg"
            title="Create the quote, generate the PDF, then open the welcome+quote review gate"
          >
            {creating ? 'Saving…' : 'Send quote →'}
          </button>
        </div>
      </div>

      <LineItemUndoToast toast={undoToast} />
      </div>
      {inquirySourceDrawer}
      {weekPromptAction && weekSections.length > 0 && (
        <WeekDecisionPrompt
          sections={weekSections}
          actionLabel={CREATE_ACTION_LABEL[weekPromptAction]}
          onPick={applyWeekCapToDept}
          onProceed={() => {
            weekAskedRef.current = true;
            const action = weekPromptAction;
            setWeekPromptAction(null);
            void createQuote(action);
          }}
          onCancel={() => {
            // They have seen the numbers; the gate has done its job.
            // Re-asking on the next press is how a prompt becomes
            // something people click through without reading.
            weekAskedRef.current = true;
            setWeekPromptAction(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────


// Shared grid template for the dept-group "table" — header row, line item
// rows, and subtotal row all use this so columns align vertically.
//   QTY · DESCRIPTION · PRICE/DAY · PICKUP · RETURN · DAYS · TOTAL · ACTIONS
const TABLE_GRID = 'grid-cols-[64px_minmax(280px,1fr)_90px_140px_140px_72px_90px_64px]';

function DepartmentGroup({
  department, rows, onChange, onDelete, onAdd, onBulkApply, onApplyWeekCap, onAddToCatalog, onCommit, onPickPackage, registerDescriptionRef,
  companyId, derivedLine, notes, rowExtras,
}: {
  department: LineItemDepartment;
  rows: ResolvedItem[];
  /** Something to render under a row — the Reservation section's
   *  "which unit" picker under each vehicle line. */
  rowExtras?: (row: ResolvedItem) => ReactNode;
  /** Per-line availability readout (VEHICLES only) — rendered as a strip
   *  under the rows so the rep sees "none free" before the quote goes out. */
  notes?: { localId: string; tone: 'good' | 'bad' | 'muted'; text: string }[];
  /** A line the section carries but the rep does not edit here — the
   *  damage waiver under the vehicles. Counted in the section subtotal. */
  derivedLine?: { label: string; note: string; rate: number; amount: number } | null;
  /** The client this quote is for — prices the catalog picker off their
   *  negotiated rate card. Null for a brand-new company (no deals yet). */
  companyId: string | null;
  onChange: (id: string, patch: Partial<ResolvedItem>) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onBulkApply: (
    dept: LineItemDepartment,
    patch: { pickupDate?: string; returnDate?: string; billableDays?: number },
  ) => void;
  onApplyWeekCap: (dept: LineItemDepartment, cap: number) => void;
  onAddToCatalog?: (id: string) => void;
  onCommit?: (id: string) => void;
  onPickPackage?: (id: string, hit: import('@/components/orders/LineItemDescriptionCombobox').CatalogHit) => void;
  registerDescriptionRef?: (id: string) => (el: HTMLInputElement | null) => void;
}) {
  const [bulkPickup, setBulkPickup] = useState('');
  const [bulkReturn, setBulkReturn] = useState('');
  const [bulkDays, setBulkDays] = useState('');
  const [appliedFlash, setAppliedFlash] = useState(false);
  // Section week-cap select — READ OFF THE ROWS, not off the last button
  // anyone pressed. It used to hold its own state starting at '' and
  // render "Week…", which is the same thing it said on a section quoting
  // every calendar day at full rate: an agent had no way to tell, and no
  // reason to open it (Wes 2026-09-11). Now it names the week in effect,
  // says "Custom days" when hand-typed counts explain none of them, and
  // only reads "Week…" when nothing in the section is dated yet.
  const weekState = weekSection(department, rows.map(weekLine));
  const inEffect = weekState?.current ?? null;
  const selectValue =
    inEffect === 'custom' ? 'custom' : typeof inEffect === 'number' ? String(inEffect) : '';
  // The deepest week still on the table, priced. The whole point of the
  // control is the money, so the money is on the outside of it.
  const savings =
    weekState && typeof weekState.current === 'number'
      ? [...weekState.options].filter((o) => o.delta < 0).sort((a, b) => a.delta - b.delta)[0] ?? null
      : null;
  const capChoices = weekCapChoices(department);
  const stdCap = defaultWeekCap(department);
  const isExpendable = department === 'EXPENDABLES';
  const showBulk = !isExpendable;

  const apply = () => {
    const patch: { pickupDate?: string; returnDate?: string; billableDays?: number } = {};
    if (bulkPickup) patch.pickupDate = bulkPickup;
    if (bulkReturn) patch.returnDate = bulkReturn;
    const n = parseInt(bulkDays, 10);
    if (Number.isFinite(n) && n > 0) patch.billableDays = n;
    if (Object.keys(patch).length === 0) return;
    onBulkApply(department, patch);
    setBulkPickup('');
    setBulkReturn('');
    setBulkDays('');
    setAppliedFlash(true);
    setTimeout(() => setAppliedFlash(false), 1800);
  };

  const subtotal = rows.reduce(
    (sum, it) =>
      sum +
      computeLineTotal({
        quantity: it.quantity,
        rate: it.rate,
        billableDays: it.billableDays,
        rateType: it.rateType,
        department: it.department,
      }),
    0,
  );

  return (
    <section className="border border-lt-hairline rounded-lg overflow-x-auto">
      {/* Group header — dept name + count + bulk-set strip */}
      <header className="flex items-center justify-between gap-2 px-3 py-2 bg-lt-card/60 border-b border-lt-hairline rounded-t-lg flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${DEPT_BADGE[department]}`}>
            {DEPARTMENT_SHORT[department]}
          </span>
          <span className="text-sm text-lt-fg font-bold">{DEPARTMENT_LABEL[department].toUpperCase()}</span>
          <span className="text-[11px] text-lt-fg3">· {rows.length} item{rows.length === 1 ? '' : 's'}</span>
        </div>
        {showBulk && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-lt-fg3">Apply to category:</span>
            {capChoices.length > 0 && (
              <>
                <select
                  value={selectValue}
                  onChange={(e) => {
                    const cap = parseInt(e.target.value, 10);
                    if (Number.isFinite(cap)) {
                      onApplyWeekCap(department, cap);
                      setAppliedFlash(true);
                      setTimeout(() => setAppliedFlash(false), 1800);
                    }
                  }}
                  title="Billing week for this whole section — every dated line is repriced at this many days per 7-day week"
                  className="bg-lt-inner border border-lt-hairline rounded px-1.5 py-0.5 text-[11px] text-lt-fg"
                >
                  {inEffect == null && <option value="">Week…</option>}
                  {inEffect === 'custom' && <option value="custom">Custom days</option>}
                  {capChoices.map((cap) => (
                    <option key={cap} value={cap}>
                      {cap}-day wk{cap === stdCap ? ' (std)' : ''}
                    </option>
                  ))}
                </select>
                {/* What the shorter weeks are worth, beside the control
                    that sets them. A HINT, deliberately not a button:
                    the deepest week is two thirds off a section, and a
                    discount that size should cost a considered click in
                    the select, not a stray one on a chip. */}
                {savings && (
                  <span
                    title={weekState!.options
                      .filter((o) => o.delta < 0)
                      .map((o) => `${o.cap}-day wk · ${o.days} billable days · ${fmtMoney(o.total)} (${fmtMoney(o.delta)})`)
                      .join('\n')}
                    className="text-[10px] text-lt-fg3 whitespace-nowrap"
                  >
                    {savings.cap}-day wk −{fmtMoney(Math.abs(savings.delta))}
                  </span>
                )}
              </>
            )}
            <input
              type="date" value={bulkPickup}
              onChange={(e) => setBulkPickup(e.target.value)}
              title="Pickup"
              className="w-32 bg-lt-inner border border-lt-hairline rounded px-1.5 py-0.5 text-[11px] text-lt-fg"
            />
            <input
              type="date" value={bulkReturn}
              onChange={(e) => setBulkReturn(e.target.value)}
              title="Return"
              className="w-32 bg-lt-inner border border-lt-hairline rounded px-1.5 py-0.5 text-[11px] text-lt-fg"
            />
            <input
              type="number" min={1} step={1} value={bulkDays}
              onChange={(e) => setBulkDays(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              placeholder="Days"
              title="Billable days"
              className="w-16 bg-lt-inner border border-lt-hairline rounded px-1.5 py-0.5 text-[11px] text-lt-fg font-mono"
            />
            <button
              onClick={apply}
              disabled={!bulkPickup && !bulkReturn && !bulkDays}
              className="px-2 py-0.5 bg-lt-fg hover:bg-black disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-[10px] font-bold rounded"
            >
              Apply
            </button>
            {appliedFlash && (
              <span className="text-[10px] font-semibold text-chip-good-fg ml-1">Applied</span>
            )}
          </div>
        )}
      </header>

      {/* Column header row — same grid as item rows so columns align across
          groups. EXPENDABLES are consumed/sold (not rented), so Pickup /
          Return / Billable-days don't apply — header labels in those
          columns are suppressed and the row cells render an em-dash. */}
      <div className={`grid ${TABLE_GRID} gap-2 px-3 py-1.5 bg-lt-card/40 border-b border-lt-hairline text-[10px] uppercase tracking-wider text-lt-fg3 font-bold items-center`}>
        <div>Qty</div>
        <div>Description</div>
        <div>{isExpendable ? 'Price' : 'Price/day'}</div>
        <div>{isExpendable ? '' : 'Pickup'}</div>
        <div>{isExpendable ? '' : 'Return'}</div>
        <div className="text-center">{isExpendable ? '' : 'Days'}</div>
        <div className="text-right">Total</div>
        <div></div>
      </div>

      {/* Line item rows */}
      <div className="divide-y divide-lt-hairline/60">
        {rows.map((it) => (
          <div key={it.localId}>
            <LineItemRow
              companyId={companyId}
              item={it}
              onChange={onChange}
              onAddToCatalog={onAddToCatalog}
              onDelete={onDelete}
              onCommit={onCommit}
              onPickPackage={onPickPackage}
              descriptionRef={registerDescriptionRef?.(it.localId)}
            />
            {rowExtras?.(it)}
          </div>
        ))}
        {notes && notes.length > 0 && (
          <div className="px-3 py-2 border-t border-lt-hairline bg-lt-card/30 space-y-1">
            {notes.map((n) => (
              <div
                key={n.localId}
                className={`text-[12px] rounded px-2 py-1 ${
                  n.tone === 'bad'
                    ? 'bg-chip-bad-bg text-chip-bad-fg font-semibold'
                    : n.tone === 'good'
                      ? 'bg-chip-good-bg text-chip-good-fg'
                      : 'text-lt-fg3'
                }`}
              >
                {n.text}
              </div>
            ))}
          </div>
        )}
        {derivedLine && (
          <div className={`grid ${TABLE_GRID} gap-2 px-3 py-2 items-center border-t border-dashed border-lt-hairline bg-chip-good-bg/40`}>
            <div className="text-sm tabular-nums text-lt-fg2 text-center">1</div>
            <div className="min-w-0">
              <div className="text-sm text-lt-fg font-medium">{derivedLine.label}</div>
              <div className="text-[11px] text-lt-fg3">{derivedLine.note}</div>
            </div>
            <div className="text-sm tabular-nums text-lt-fg2 text-right">{fmtMoney(derivedLine.rate)}</div>
            <div className="col-span-3 text-[11px] text-lt-fg3">Follows the vehicle lines above</div>
            <div className="text-right tabular-nums text-chip-good-fg text-base font-bold">{fmtMoney(derivedLine.amount)}</div>
            <div></div>
          </div>
        )}
      </div>

      {/* Per-category add — drops a blank row defaulted to this
          department so the rep can extend the group without leaving
          the section. Pairs with the top "+ Add line manually" which
          defaults to PRO_SUPPLIES. */}
      <div className="px-3 py-2 border-t border-lt-hairline bg-lt-card/30">
        <button
          type="button"
          onClick={onAdd}
          className="text-xs font-semibold text-lt-fg2 hover:text-lt-fg"
          title={`Add a new ${DEPARTMENT_LABEL[department]} line`}
        >
          + Add {DEPARTMENT_LABEL[department]} line
        </button>
      </div>

      {/* Subtotal row */}
      <div className={`grid ${TABLE_GRID} gap-2 px-3 py-2 bg-lt-card/40 border-t border-lt-hairline text-lt-fg2 items-center`}>
        <div className="col-span-6 font-bold uppercase tracking-wider text-[11px]">Subtotal</div>
        <div className="text-right tabular-nums text-chip-good-fg text-base font-bold">{fmtMoney(subtotal + (derivedLine?.amount ?? 0))}</div>
        <div></div>
      </div>
    </section>
  );
}

function LineItemRow({
  item, onChange, onDelete, onCommit, onPickPackage, onAddToCatalog, descriptionRef, companyId,
}: {
  item: ResolvedItem;
  /** Custom-line promotion: opens the add-to-catalog modal for this row. */
  onAddToCatalog?: (id: string) => void;
  /** Passed to the description combobox so a picked row pre-fills the
   *  client's negotiated rate instead of list. */
  companyId: string | null;
  onChange: (id: string, patch: Partial<ResolvedItem>) => void;
  onDelete: (id: string) => void;
  /** Parent-level commit: auto-append empty row + focus its
   *  description input when this row's combobox emits commit. */
  onCommit?: (id: string) => void;
  /** Package pick handler — escapes the per-row patch to insert
   *  header + member rows at the parent level. */
  onPickPackage?: (id: string, hit: import('@/components/orders/LineItemDescriptionCombobox').CatalogHit) => void;
  /** Ref the parent passes for the row's description input so the
   *  next-row auto-append can move focus. */
  descriptionRef?: React.Ref<HTMLInputElement>;
}) {
  const id = item.localId;

  const total = computeLineTotal({
    quantity: item.quantity,
    rate: item.rate,
    billableDays: item.billableDays,
    rateType: item.rateType,
    department: item.department,
  });
  const breakdown = billingBreakdown({
    quantity: item.quantity,
    rate: item.rate,
    billableDays: item.billableDays,
    rateType: item.rateType,
    department: item.department,
  });
  const matched = item.catalogProductId != null;
  const isExpendable = item.department === 'EXPENDABLES';
  const allowedRateTypes = availableRateTypes(
    item.department,
    new Date(item.pickupDate),
    new Date(item.returnDate),
  );
  // Toggle is only shown when allowedRateTypes is non-empty (STAGES today).
  // EXPENDABLES is purchase-only; cap-per-week depts apply cap math
  // automatically based on billableDays alone — no user-facing toggle.
  const showToggle = allowedRateTypes.length > 0;
  const visibleRateTypes: RateType[] = item.department === 'STAGES'
    ? ['DAILY', 'WEEKLY', 'MONTHLY']
    : [];

  const applyMatch = (m: CatalogSearchResult) => {
    // Package picks escape to the parent — they're not a single-row
    // patch, they insert a header + N member rows.
    if (m.type === 'PACKAGE' && onPickPackage) {
      onPickPackage(id, m as unknown as import('@/components/orders/LineItemDescriptionCombobox').CatalogHit);
      return;
    }
    onChange(id, {
      description: m.name,
      catalogProductId: m.id,
      catalogType: m.type,
      department: m.department,
      rate: pickRate(m, item.rateType),
      matchedProduct: { id: m.id, type: m.type, name: m.name },
      matchSource: 'AI',
    });
  };

  // Stages discount text — only shown for WEEKLY/MONTHLY since DAILY (and
  // every other dept) is self-explanatory from the columnar values.
  const showStagesDiscountNote =
    item.department === 'STAGES' &&
    (item.rateType === 'WEEKLY' || item.rateType === 'MONTHLY');

  const dash = <span className="text-lt-fg3">—</span>;

  const isMember = !!item.isPackageMember;
  const isHeader = !!item.isPackageHeader;

  return (
    <div className={`px-3 py-2 hover:bg-lt-card/30 ${isMember ? 'bg-violet-50/30 pl-8' : ''}`}>
      <div className={`grid ${TABLE_GRID} gap-2 items-start`}>
        {/* QTY — primary scan target; bigger digit, no extra height */}
        <IntegerInput
          value={item.quantity}
          onChange={(next) => onChange(id, { quantity: next })}
          min={1}
          ariaLabel="Quantity"
          className="w-full bg-lt-card border border-lt-hairline rounded px-2 py-1 text-base font-bold tabular-nums text-lt-fg"
        />

        {/* DESCRIPTION column — combobox + quiet status pill */}
        <div className="space-y-1 min-w-0">
          {isHeader && (
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200">
                PKG · header
              </span>
              {item.isPackageModified && (
                <span
                  className="inline-flex items-center text-[10px] text-amber-700"
                  title="Package contents modified — verify pricing"
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1" />
                  contents modified — verify pricing
                </span>
              )}
            </div>
          )}
          {isMember && (
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-violet-600">
                ↳ member
              </span>
            </div>
          )}
          {/* Description combobox — the section header already names
              the dept, so the per-row dept badge that used to sit here
              was duplicative chrome. Removed for one calmer focal point. */}
          <LineItemDescriptionCombobox
            companyId={companyId}
            value={item.description}
            onChange={(next) => onChange(id, { description: next })}
            onAddToCatalog={onAddToCatalog ? () => onAddToCatalog(id) : undefined}
            onPickCatalog={(hit) => applyMatch(hit as CatalogSearchResult)}
            catalogBinding={
              item.catalogProductId && item.matchedProduct
                ? { id: item.catalogProductId, type: item.matchedProduct.type, name: item.matchedProduct.name }
                : null
            }
            onClearCatalog={() =>
              onChange(id, {
                catalogProductId: null,
                catalogType: null,
                matchedProduct: null,
                matchSource: null,
              })
            }
            onCommit={() => onCommit?.(id)}
            ref={descriptionRef}
            placeholder="New line item — type to search inventory"
          />
          {item.qualifier && (
            <div className="text-xs text-lt-fg2 italic">— {item.qualifier}</div>
          )}
        </div>

        {/* PRICE/DAY — money-grain, bumped for at-a-glance reads */}
        <CurrencyInput
          value={item.rate}
          onChange={(next) => onChange(id, { rate: next })}
          min={0}
          inputClassName="bg-lt-card border border-lt-hairline rounded px-2 py-1 text-base font-bold tabular-nums text-lt-fg"
          ariaLabel="Price per day"
        />

        {/* PICKUP */}
        {isExpendable ? (
          <div className="text-center text-sm self-center">{dash}</div>
        ) : (
          <input
            type="date" value={item.pickupDate}
            onChange={(e) => onChange(id, { pickupDate: e.target.value })}
            className="w-full bg-lt-card border border-lt-hairline rounded px-2 py-1 text-xs text-lt-fg"
          />
        )}

        {/* RETURN */}
        {isExpendable ? (
          <div className="text-center text-sm self-center">{dash}</div>
        ) : (
          <input
            type="date" value={item.returnDate}
            onChange={(e) => onChange(id, { returnDate: e.target.value })}
            className="w-full bg-lt-card border border-lt-hairline rounded px-2 py-1 text-xs text-lt-fg"
          />
        )}

        {/* BILLABLE DAYS — input + (STAGES) inline rate-type toggle below */}
        {isExpendable ? (
          <div className="text-center text-sm self-center">{dash}</div>
        ) : (
          <div className="space-y-1">
            {/* (STEP 1C) null = TBD. Empty input is the null state;
                typing a number commits a value; clearing it reverts
                to null. Placeholder "TBD" makes the undated state
                obvious before the rep commits dates. */}
            <input
              type="number" min={1} step={1}
              value={item.billableDays ?? ''}
              placeholder="TBD"
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === '') {
                  onChange(id, { billableDays: null });
                } else {
                  onChange(id, { billableDays: Math.max(1, Number(raw) || 1) });
                }
              }}
              className="w-full bg-lt-card border border-lt-hairline rounded px-1 py-1 text-base font-bold tabular-nums text-lt-fg text-center"
            />
            {showToggle && (
              <div className="flex bg-lt-card border border-lt-hairline rounded p-0.5">
                {visibleRateTypes.map((rt) => {
                  const enabled = allowedRateTypes.includes(rt);
                  const reason =
                    rt === 'WEEKLY' && !enabled
                      ? 'Available at >7 calendar days'
                      : rt === 'MONTHLY' && !enabled
                        ? 'Available at >28 calendar days'
                        : '';
                  return (
                    <button
                      key={rt}
                      onClick={() => enabled && onChange(id, { rateType: rt })}
                      disabled={!enabled}
                      title={reason}
                      className={`flex-1 px-1 py-0.5 text-[9px] font-semibold rounded ${
                        item.rateType === rt
                          ? 'bg-lt-fg text-white'
                          : enabled
                            ? 'text-lt-fg2 hover:text-lt-fg'
                            : 'text-lt-fg3 cursor-not-allowed'
                      }`}
                    >
                      {rt === 'DAILY' ? 'D' : rt === 'WEEKLY' ? 'W' : 'M'}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TOTAL — the row's punchline. Bigger and bolder than the
            inputs feeding it so the eye lands here when scanning down. */}
        <div className="text-right self-center pt-1">
          {isExpendable || item.billableDays != null ? (
            <span className="text-lg font-bold tabular-nums text-chip-good-fg">
              {fmtMoney(total)}
            </span>
          ) : (
            <div className="flex flex-col items-end leading-tight">
              <span className="text-sm font-semibold tabular-nums text-chip-good-fg">
                {fmtMoney(item.rate)}/day
              </span>
              <span className="text-[10px] text-lt-fg3">total on dates</span>
            </div>
          )}
        </div>

        {/* ACTIONS — visible × for one-tap removal + the existing kebab
            for less-common actions (change department). Two affordances
            so the rep doesn't have to open the menu just to drop a row. */}
        <div className="self-center flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={() => onDelete(id)}
            className="w-7 h-7 inline-flex items-center justify-center rounded text-lt-fg3 hover:text-chip-bad-fg hover:bg-chip-bad-bg/40 text-xl leading-none"
            title="Remove line item"
            aria-label={`Remove ${item.description || 'line item'}`}
          >
            ×
          </button>
          <RowActionsMenu
            currentDepartment={item.department}
            onChangeDepartment={(d) => onChange(id, { department: d })}
            onDelete={() => onDelete(id)}
          />
        </div>
      </div>

      {showStagesDiscountNote && (
        <div className="mt-1 text-[10px] text-lt-fg3 leading-tight">{breakdown}</div>
      )}
      {item.rateTypeAutoResetNote && (
        <div className="mt-1 text-[10px] text-lt-fg italic">{item.rateTypeAutoResetNote}</div>
      )}
    </div>
  );
}

function RowActionsMenu({
  currentDepartment, onChangeDepartment, onDelete,
}: {
  currentDepartment: LineItemDepartment;
  onChangeDepartment: (d: LineItemDepartment) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingDept, setEditingDept] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-1 py-0.5 text-lt-fg3 hover:text-lt-fg text-sm"
        title="Row actions"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 w-48 bg-lt-card border border-lt-hairline rounded-lg shadow-lg p-1 space-y-0.5">
          {editingDept ? (
            <select
              value={currentDepartment}
              onChange={(e) => {
                onChangeDepartment(e.target.value as LineItemDepartment);
                setEditingDept(false);
                setOpen(false);
              }}
              autoFocus
              className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1 text-[11px] text-lt-fg"
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{DEPARTMENT_LABEL[d]}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingDept(true)}
              className="w-full text-left px-2 py-1.5 text-[11px] text-lt-fg hover:bg-lt-inner rounded"
            >
              Change department
            </button>
          )}
          <button
            onClick={() => { onDelete(); setOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-[11px] text-chip-bad-fg hover:bg-lt-inner rounded"
          >
            Remove line item
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PEOPLE — AI-extracted contacts for human review (commit X)
// ─────────────────────────────────────────────────────────────────────────

const MATCH_BADGE: Record<ContactMatchStatus, { label: string; cls: string }> = {
  existing:        { label: 'Existing',      cls: 'bg-chip-good-bg text-chip-good-fg border-chip-good-fg/30' },
  new:             { label: 'New',           cls: 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30' },
  possible_match:  { label: '? Possible match', cls: 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30' },
};

const SOURCE_LABEL: Record<ContactSource, string> = {
  header:        'from header',
  signature:     'from signature',
  body_mention:  'mentioned in body',
};

interface PersonHit {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: { id: string; name: string } | null;
}

// Compact typeahead to link an AI-extracted contact to an existing CRM
// person (searches /api/persons?q=). On pick the parent flips the row to
// match_status='existing' so submit associates the CRM record instead of
// minting a new one.
function PersonSearchField({ onPick }: { onPick: (p: PersonHit) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 1) { setHits([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/persons?q=${encodeURIComponent(q)}`);
        const d = await r.json();
        setHits(d.persons || []);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        autoComplete="off"
        name=""
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => q.trim().length >= 1 && setOpen(true)}
        placeholder="Link an existing CRM contact…"
        className="w-full px-2 py-1 bg-lt-inner border border-lt-hairline rounded text-[12px] text-lt-fg placeholder:text-lt-fg3"
      />
      {open && q.trim().length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-lt-card border border-lt-hairline rounded-lg shadow-lg z-20 overflow-hidden max-h-60 overflow-y-auto">
          {loading && hits.length === 0 && <div className="px-3 py-2 text-[11px] text-lt-fg3">Searching…</div>}
          {!loading && hits.length === 0 && <div className="px-3 py-2 text-[11px] text-lt-fg3">No matches — type a name and use the fields below to add a new contact.</div>}
          {hits.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onPick(p); setOpen(false); setQ(''); }}
              className="w-full text-left px-3 py-2 hover:bg-lt-inner border-b border-lt-hairline/50 last:border-0"
            >
              <div className="text-[12px] font-semibold text-lt-fg">{p.firstName} {p.lastName}</div>
              <div className="text-[10px] text-lt-fg3">{p.email || '(no email)'}{p.company ? ` · ${p.company.name}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PeopleSection({
  contacts,
  setContacts,
}: {
  contacts: ResolvedContact[];
  setContacts: React.Dispatch<React.SetStateAction<ResolvedContact[]>>;
}) {
  const updateContact = (idx: number, patch: Partial<ResolvedContact>) => {
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  // Quick-add affordance for phone-inquiry clients who weren't on
  // any parsed email. Appends a blank-but-include=true row that the
  // rep fills in inline. The save handler will mint the Person via
  // POST /api/crm/people (with source="phone_inquiry") because the
  // row has match_status='new' and no existing_person_id.
  const addBlankContact = () => {
    setContacts((prev) => [
      ...prev,
      {
        name: '',
        email: '',
        title: null,
        phone: null,
        company: null,
        suggested_role: null,
        source: 'header',
        confidence: 'high',
        match_status: 'new',
        existing_person_id: null,
        candidate_person_id: null,
        include: true,
        role: 'PRODUCER',
      },
    ]);
  };

  const includedCount = contacts.filter((c) => c.include).length;
  const emptyContacts = contacts.length === 0;

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold text-lt-fg">
          {emptyContacts
            ? 'Client contact'
            : `People on this thread (${includedCount} of ${contacts.length} selected)`}
        </h2>
        <div className="flex items-center gap-3">
          <p className="text-[11px] text-lt-fg3">Will associate with the new Job on save</p>
          <button
            type="button"
            onClick={addBlankContact}
            className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 underline"
          >
            + Quick add contact
          </button>
        </div>
      </div>
      {emptyContacts && (
        <p className="text-[12px] text-lt-fg3">
          No contacts attached yet. <span className="text-lt-fg2">+ Quick add contact</span> above
          for phone-inquiry clients who aren&apos;t in CRM yet — name, email, phone, role. Source is logged as
          <span className="font-mono text-lt-fg2"> phone_inquiry</span>.
        </p>
      )}
      <div className="space-y-2">
        {contacts.map((c, idx) => {
          const badge = MATCH_BADGE[c.match_status];
          const isLinked = c.match_status === 'existing' && !!c.existing_person_id;
          const linkExisting = (p: PersonHit) =>
            updateContact(idx, {
              match_status: 'existing',
              existing_person_id: p.id,
              candidate_person_id: null,
              decision: undefined,
              name: `${p.firstName} ${p.lastName}`.trim(),
              email: p.email || '',
              phone: p.phone || c.phone,
              company: p.company?.name ?? c.company,
            });
          const unlink = () =>
            updateContact(idx, { match_status: 'new', existing_person_id: null });
          return (
            <div
              key={`${c.email}-${idx}`}
              className={`border rounded-lg p-3 space-y-2 ${
                c.include ? 'bg-lt-card/60 border-lt-hairline' : 'bg-lt-inner/40 border-lt-hairline opacity-70'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={c.include}
                  onChange={(e) => updateContact(idx, { include: e.target.checked })}
                  className="mt-1 h-3.5 w-3.5 accent-lt-fg"
                  aria-label={`Include ${c.name || c.email}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="text-[10px] text-lt-fg3">· {SOURCE_LABEL[c.source]} ({c.confidence})</span>
                  </div>
                  {isLinked ? (
                    // Linked to an existing CRM person — show the record + a
                    // way to switch back to searching / adding a new one.
                    <div className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-chip-good-fg/30 bg-chip-good-bg px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-lt-fg truncate">{c.name || '(no name)'}</div>
                        <div className="text-[10px] text-chip-good-fg">
                          Linked to CRM{c.email ? ` · ${c.email}` : ''}{c.company ? ` · ${c.company}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={unlink}
                        className="flex-shrink-0 text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg underline"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {/* Search the CRM to link an existing contact… */}
                      <PersonSearchField onPick={linkExisting} />
                      {/* …or fill these to add a new one. */}
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={c.name}
                          onChange={(e) => updateContact(idx, { name: e.target.value })}
                          placeholder="Name"
                          className="px-2 py-1 bg-lt-inner border border-lt-hairline rounded text-[12px] text-lt-fg"
                        />
                        <input
                          type="email"
                          value={c.email}
                          onChange={(e) => updateContact(idx, { email: e.target.value })}
                          placeholder="Email"
                          className="px-2 py-1 bg-lt-inner border border-lt-hairline rounded text-[12px] text-lt-fg"
                        />
                        <input
                          type="text"
                          value={c.title || ''}
                          onChange={(e) => updateContact(idx, { title: e.target.value || null })}
                          placeholder="Title (optional)"
                          className="px-2 py-1 bg-lt-inner border border-lt-hairline rounded text-[12px] text-lt-fg"
                        />
                        <input
                          type="tel"
                          value={c.phone || ''}
                          onChange={(e) => updateContact(idx, { phone: e.target.value || null })}
                          placeholder="Phone"
                          className="px-2 py-1 bg-lt-inner border border-lt-hairline rounded text-[12px] text-lt-fg"
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <label className="text-[10px] text-lt-fg3 uppercase tracking-wider" title="Their role on this job — distinct from their job Title above">Role on job</label>
                    <select
                      value={c.role}
                      onChange={(e) => updateContact(idx, { role: e.target.value as SuggestedJobRole })}
                      className="px-2 py-1 bg-lt-inner border border-lt-hairline rounded text-[12px] text-lt-fg"
                    >
                      {JOB_ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    {c.match_status === 'possible_match' && (
                      <select
                        value={c.decision || 'create_new'}
                        onChange={(e) => updateContact(idx, { decision: e.target.value as 'merge' | 'create_new' })}
                        className="px-2 py-1 bg-lt-inner border border-chip-warn-fg/30 rounded text-[12px] text-chip-warn-fg"
                        title="Same name found in CRM with a different email — decide what to do"
                      >
                        <option value="create_new">Create new person</option>
                        <option value="merge">Use existing match</option>
                      </select>
                    )}
                  </div>
                  <p className="text-[10px] text-lt-fg3 mt-1.5">
                    {c.match_status === 'existing'
                      ? `Will associate existing CRM record as ${c.role}.`
                      : c.match_status === 'possible_match'
                        ? c.decision === 'merge'
                          ? `Will associate the matched person as ${c.role} (existing fields unchanged).`
                          : `Will add new CRM person + associate as ${c.role}.`
                        : `Will add new CRM person + associate as ${c.role}.`}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

