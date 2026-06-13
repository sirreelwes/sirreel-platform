'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { LineItemDepartment, ProductionType, RateType } from '@prisma/client';
import { JobPicker, EMPTY_JOB_PICKER_VALUE, type JobPickerValue } from '@/components/shared/JobPicker';
import { LineItemRowActions } from '@/components/lineItems/LineItemRowActions';
import { LineItemUndoToast, type LineItemUndoToastState } from '@/components/lineItems/LineItemUndoToast';
import { LineItemDescriptionCombobox } from '@/components/orders/LineItemDescriptionCombobox';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
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
  billingBreakdown,
  computeLineTotal,
  defaultRateType,
} from '@/lib/orders/billing';

const DEPARTMENTS: LineItemDepartment[] = [
  'VEHICLES', 'COMMUNICATIONS', 'STAGES', 'GE', 'EXPENDABLES', 'PRO_SUPPLIES', 'ART',
];

type CatalogType = 'INVENTORY' | 'ASSET_CATEGORY' | 'PACKAGE';

interface ResolvedItem {
  description: string;
  quantity: number;
  catalogProductId: string | null;
  catalogType: CatalogType | null;
  department: LineItemDepartment;
  qualifier: string | null;
  rateType: RateType;
  pickupDate: string;  // ISO YYYY-MM-DD
  returnDate: string;  // ISO YYYY-MM-DD
  billableDays: number;
  rate: number;
  matchedProduct: { id: string; type: CatalogType; name: string } | null;
  matchSource: 'AI' | 'ALIAS_FALLBACK' | null;
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
type SuggestedJobRole = 'PRODUCER' | 'PM' | 'PC' | 'TRANSPO' | 'ACCOUNTING' | 'OTHER';
const JOB_ROLES: SuggestedJobRole[] = ['PRODUCER', 'PM', 'PC', 'TRANSPO', 'ACCOUNTING', 'OTHER'];

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
  delivery?: { method?: string | null; address?: string | null };
  cart?: {
    itemId: string;
    code: string;
    name: string;
    type: string;
    category: string;
    unitPrice: number;
    quantity: number;
    days: number | null;
    lineTotal: number;
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
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

// ─────────────────────────────────────────────────────────────────────────
// Draft state — survive the round-trip to /crm and back.
// ─────────────────────────────────────────────────────────────────────────
//
// When the AI fails to extract a customer, the user clicks "Pick one in
// CRM," which navigates away from this page. Without persistence, the
// component remounts on return and Review Quote re-renders as the
// pre-parse input page — all parsed line items, contacts, edits gone.
//
// Tactical fix: serialize the post-parse state to sessionStorage before
// navigating, restore on mount when clientCompanyId is in the URL,
// clear once the quote is saved. Keyed by inquiryId (or a sentinel)
// so concurrent quote captures in different tabs don't collide.
//
// A future refactor (persist as DRAFT Order in the DB at parse time
// and load by id) gives stable URLs and shareable drafts. Not in scope
// for this fix.

interface DraftState {
  savedAt: number;
  parsed: ParsedTop | null;
  items: ResolvedItem[];
  editing: ParsedTop;
  selectedClientId: string;
  contacts: ResolvedContact[];
  emailText: string;
  job: JobPickerValue;
  candidateJobs: AttachableJob[];
  discountAmount: string;
  discountLabel: string;
  newJobProductionType: ProductionType;
  newJobProductionTypeProfileId: string | null;
  newJobNotes: string;
}

const DRAFT_TTL_MS = 30 * 60_000; // entries older than 30 min are stale

function draftKey(inquiryId: string | null): string {
  return `newQuoteDraft:${inquiryId || '__none'}`;
}

function saveDraftState(inquiryId: string | null, state: Omit<DraftState, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: DraftState = { ...state, savedAt: Date.now() };
    sessionStorage.setItem(draftKey(inquiryId), JSON.stringify(payload));
  } catch (err) {
    console.warn('[new-quote] failed to save draft state:', err);
  }
}

function readDraftState(inquiryId: string | null): DraftState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(draftKey(inquiryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftState;
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      sessionStorage.removeItem(draftKey(inquiryId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearDraftState(inquiryId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(draftKey(inquiryId));
  } catch {}
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

export default function NewQuotePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-lt-fg2">Loading…</div>}>
      <NewQuotePageInner />
    </Suspense>
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

  // Job decision is deferred until AFTER AI parse — see candidateJobs
  // fetch + JobPicker render below. Default mode is `searching` so
  // save stays blocked until the user explicitly picks an existing
  // Job or commits to creating a new one.
  const [job, setJob] = useState<JobPickerValue>(EMPTY_JOB_PICKER_VALUE);
  const [candidateJobs, setCandidateJobs] = useState<AttachableJob[]>([]);

  const [inquiry, setInquiry] = useState<InquiryRecord | null>(null);

  const [inputMode, setInputMode] = useState<'paste' | 'pdf'>('paste');
  const [emailText, setEmailText] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedTop | null>(null);
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [undoToast, setUndoToast] = useState<LineItemUndoToastState | null>(null);
  const [editing, setEditing] = useState<ParsedTop>({});
  const [clientCandidates, setClientCandidates] = useState<ClientCandidate[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [contacts, setContacts] = useState<ResolvedContact[]>([]);

  const [creating, setCreating] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountLabel, setDiscountLabel] = useState('');

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
    if (!parsed || !selectedClientId || selectedClientId === '__new__') {
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

        // Strong-match auto-select: exactly one candidate with >50%
        // date overlap with the AI-extracted range. Only fires when
        // the user hasn't already committed to a choice; otherwise we
        // would clobber their explicit pick on every re-fetch.
        if (filtered.length === 1 && extractedStart != null && extractedEnd != null && job.mode === 'searching') {
          const only = filtered[0];
          const start = only.startDate ? new Date(only.startDate).getTime() : null;
          const end = only.endDate ? new Date(only.endDate).getTime() : start;
          if (start != null && end != null) {
            const overlapStart = Math.max(extractedStart, start);
            const overlapEnd = Math.min(extractedEnd, end);
            const overlapDays = Math.max(0, (overlapEnd - overlapStart) / 86_400_000);
            const askedDays = Math.max(1, (extractedEnd - extractedStart) / 86_400_000);
            if (overlapDays / askedDays > 0.5) {
              setJob({
                jobId: only.id,
                jobCode: only.jobCode,
                name: only.name,
                mode: 'selected_existing',
                company: only.company,
              });
            }
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

  // Restore Review-Quote draft state when returning from /crm. The
  // session-saved snapshot is only read when ?clientCompanyId is in
  // the URL (the marker of a CRM-return), so fresh new-quote visits
  // never pick up a stale draft. Runs once per mount; the
  // clientCompanyId effect below overrides selectedClientId after.
  useEffect(() => {
    if (!clientCompanyIdFromUrl) return;
    const draft = readDraftState(inquiryId);
    if (!draft) return;
    setParsed(draft.parsed);
    setItems(draft.items);
    setEditing(draft.editing);
    setContacts(draft.contacts);
    setEmailText(draft.emailText);
    setJob(draft.job ?? EMPTY_JOB_PICKER_VALUE);
    setCandidateJobs(draft.candidateJobs);
    setDiscountAmount(draft.discountAmount);
    setDiscountLabel(draft.discountLabel);
    setNewJobProductionType(draft.newJobProductionType ?? 'OTHER');
    setNewJobProductionTypeProfileId(draft.newJobProductionTypeProfileId ?? null);
    setNewJobNotes(draft.newJobNotes ?? '');
    // selectedClientId is intentionally NOT restored here — the next
    // effect sets it to clientCompanyIdFromUrl, which is exactly what
    // the user just picked. Restoring the old empty value first would
    // race the company-fetch.
  }, [clientCompanyIdFromUrl, inquiryId]);

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
        const isSupplyOrder = meta?.kind === 'supply-order' && Array.isArray(meta.cart) && meta.cart.length > 0;

        if (isSupplyOrder) {
          // Build the post-parse state directly from the cart snapshot.
          // No AI parse runs; the user lands on the review step.
          const startISO = (meta!.dates?.start ?? inq.preferredStartDate ?? '').slice(0, 10);
          const endISO = (meta!.dates?.end ?? inq.preferredEndDate ?? startISO).slice(0, 10);
          const fallbackProductionName =
            meta!.production?.jobName?.trim() ||
            inq.title.replace(/^Supply request — /, '');

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

          // Cart → ResolvedItem[]. Every cart line carries an
          // InventoryItem id already (server-validated on submission),
          // so we bind matchedProduct directly. rateType for
          // EXPENDABLE lines is FLAT (consumable; qty × rate, no
          // billable days); EQUIPMENT is DAILY and inherits the
          // rental window. matchSource=null because no AI/alias
          // matching ran — the catalog id is canonical.
          const items: ResolvedItem[] = meta!.cart!.map((line) => {
            const isExpendable = line.type === 'EXPENDABLE';
            return {
              description: line.name,
              quantity: line.quantity,
              catalogProductId: line.itemId,
              catalogType: 'INVENTORY',
              department: 'PRO_SUPPLIES',
              qualifier: null,
              rateType: isExpendable ? 'FLAT' : 'DAILY',
              pickupDate: startISO || new Date().toISOString().slice(0, 10),
              returnDate: endISO || startISO || new Date().toISOString().slice(0, 10),
              billableDays: isExpendable ? 1 : line.days ?? 1,
              rate: line.unitPrice,
              matchedProduct: { id: line.itemId, type: 'INVENTORY', name: line.name },
              matchSource: null,
              warnings: [],
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
      setItems(data.items || []);
      setClientCandidates(data.clientMatch || []);
      setContacts(hydrateContacts(data.contacts));
      if (data.clientMatch?.length === 1 && !selectedClientId) {
        setSelectedClientId(data.clientMatch[0].id);
      }
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
    try {
      const fd = new FormData();
      fd.append('file', pdfFile);
      const pdfRes = await fetch('/api/orders/parse-pdf', { method: 'POST', body: fd });
      const pdfData = await pdfRes.json();
      if (!pdfRes.ok) {
        alert(pdfData.error || 'PDF parse failed');
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
        alert(parseData.error || 'Parse failed');
        return;
      }
      setParsed(parseData.parsed);
      setEditing((prev) => ({ ...prev, ...parseData.parsed }));
      setItems(parseData.items || []);
      setClientCandidates(parseData.clientMatch || []);
      setContacts(hydrateContacts(parseData.contacts));
    } finally {
      setParsing(false);
    }
  };

  const updateItem = (idx: number, patch: Partial<ResolvedItem>) => {
    setItems((prev) => {
      const target = prev[idx];
      if (!target) return prev;

      // Header-driven cascade: when a package header's pickupDate /
      // returnDate / billableDays changes, all members in the same
      // packageInstance inherit. Availability depends on member dates
      // staying in sync; reps shouldn't have to walk each row.
      const headerCascadeFields = (['pickupDate', 'returnDate', 'billableDays'] as const)
        .filter((f) => patch[f] !== undefined && patch[f] !== target[f])
      if (target.isPackageHeader && target.packageInstanceId && headerCascadeFields.length > 0) {
        return prev.map((it) => {
          if (it === target) return applyRowPatch(it, patch)
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
          if (it === target) return applyRowPatch(it, patch)
          if (it.packageInstanceId === target.packageInstanceId && it.isPackageHeader) {
            return { ...it, isPackageModified: true }
          }
          return it
        })
      }

      return prev.map((it, i) => (i === idx ? applyRowPatch(it, patch) : it))
    });
  };

  // Pulled out so the header-cascade and member-edit paths can reuse
  // the same rateType-normalization logic.
  function applyRowPatch(it: ResolvedItem, patch: Partial<ResolvedItem>): ResolvedItem {
        const next: ResolvedItem = { ...it, ...patch };

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
  const removeItem = (idx: number) => {
    setItems((prev) => {
      const removed = prev[idx];
      if (!removed) return prev;
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
        const next = prev.filter((_, i) => i !== idx).map((it) =>
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
      const next = prev.filter((_, i) => i !== idx);
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
        return next;
      }),
    );
  };

  // Quote-level date change: propagate to line items whose pickupDate /
  // returnDate currently matches the old quote-level value (i.e., haven't
  // been individually overridden). Lines with custom dates stay as-is.
  const updateQuoteDate = (field: 'startDate' | 'endDate', newValue: string) => {
    const oldValue = editing[field] || '';
    setEditing((prev) => ({ ...prev, [field]: newValue }));
    if (!newValue || !oldValue || newValue === oldValue) return;
    setItems((prev) =>
      prev.map((it) => {
        const lineField = field === 'startDate' ? 'pickupDate' : 'returnDate';
        if (it[lineField] === oldValue) {
          return { ...it, [lineField]: newValue };
        }
        return it;
      }),
    );
  };

  const addBlankItem = () => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const pickup = editing.startDate || today;
    const ret = editing.endDate || tomorrow;
    setItems((prev) => [
      ...prev,
      {
        // Empty so the rep's typed name is the only thing that ever
        // lands in the saved row. "New line item" now renders as the
        // input's HTML placeholder (greyed prompt) — never as a real
        // value the user has to delete before typing. Prior behavior
        // (hardcoded value) made "New line item" the actual saved
        // description whenever a rep moved past the row without
        // selecting + clearing it.
        description: '',
        quantity: 1,
        catalogProductId: null,
        catalogType: null,
        department: 'PRO_SUPPLIES',
        qualifier: null,
        rateType: 'DAILY',
        pickupDate: pickup,
        returnDate: ret,
        billableDays: 1,
        rate: 0,
        matchedProduct: null,
        matchSource: null,
        warnings: [],
      },
    ]);
  };

  // ─── Auto-append + focus management for the combobox flow ───────
  // Refs map indexed by row position in the `items` array. Combobox
  // registers its underlying input ref on mount; we use it to focus
  // either the next existing row (same dept) or a freshly appended
  // blank row after commit. `pendingFocusIdx` is the "next idx I want
  // to focus once it's rendered" — the effect below applies it.
  const descriptionRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const [pendingFocusIdx, setPendingFocusIdx] = useState<number | null>(null);

  const registerDescriptionRef = useCallback((idx: number) => (el: HTMLInputElement | null) => {
    if (el) descriptionRefs.current.set(idx, el);
    else descriptionRefs.current.delete(idx);
  }, []);

  useEffect(() => {
    if (pendingFocusIdx == null) return;
    const el = descriptionRefs.current.get(pendingFocusIdx);
    if (el) {
      // Defer to next microtask so layout has settled.
      requestAnimationFrame(() => {
        el.focus();
        // Position cursor at end for fast continuous entry.
        const v = el.value;
        el.setSelectionRange(v.length, v.length);
      });
      setPendingFocusIdx(null);
    }
  }, [pendingFocusIdx, items.length]);

  // Package pick: replace the current row with a HEADER carrying the
  // package's pricePerDay + insert MEMBER rows after it (rate=0,
  // shared packageInstanceId). Members render indented under the
  // header. Header price drives the order math; members are $0.
  const handlePickPackage = useCallback((
    targetIdx: number,
    hit: import('@/components/orders/LineItemDescriptionCombobox').CatalogHit,
  ) => {
    if (!hit.items || hit.items.length === 0) return;
    const instanceId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setItems((prev) => {
      const target = prev[targetIdx];
      if (!target) return prev;
      const pickup = target.pickupDate;
      const ret = target.returnDate;
      const days = target.billableDays;
      const header: ResolvedItem = {
        ...target,
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

  const handleRowCommit = useCallback((committedIdx: number) => {
    const committed = items[committedIdx];
    if (!committed) return;
    // Look for the next existing row in the same department.
    const sameDept = items
      .map((it, i) => ({ it, i }))
      .filter((r) => r.it.department === committed.department);
    const positionInDept = sameDept.findIndex((r) => r.i === committedIdx);
    const nextSameDept = sameDept[positionInDept + 1];
    if (nextSameDept) {
      setPendingFocusIdx(nextSameDept.i);
      return;
    }
    // Append a fresh blank row in the same department + focus its
    // combobox. The new row's index is items.length at the moment
    // setItems fires.
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const pickup = editing.startDate || today;
    const ret = editing.endDate || tomorrow;
    setItems((prev) => [
      ...prev,
      {
        description: '',
        quantity: 1,
        catalogProductId: null,
        catalogType: null,
        department: committed.department,
        qualifier: null,
        rateType: 'DAILY',
        pickupDate: pickup,
        returnDate: ret,
        billableDays: 1,
        rate: 0,
        matchedProduct: null,
        matchSource: null,
        warnings: [],
      },
    ]);
    setPendingFocusIdx(items.length);
  }, [items, editing.startDate, editing.endDate]);

  const orderTotal = useMemo(() => {
    const lineSum = items.reduce(
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
    const discount = parseFloat(discountAmount) || 0;
    return lineSum + discount;
  }, [items, discountAmount]);

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
  // gate against the TSX welcome+quote template.
  type CreateAction = 'draft' | 'preview' | 'download' | 'send';

  const createQuote = async (action: CreateAction = 'draft') => {
    if (!canCreate) return;
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
      let companyId: string;
      let inlineJob: {
        name: string;
        productionType: ProductionType;
        productionTypeProfileId: string | null;
        startDate: string | null;
        endDate: string | null;
        notes: string | null;
        contacts: { personId: string; role: SuggestedJobRole; isPrimary: boolean }[];
      } | null = null;
      let existingJobId: string | null = null;

      if (job.mode === 'selected_existing' && job.jobId) {
        existingJobId = job.jobId;
        // company comes off the picked Job (which carries it). Falls
        // back to the form's selectedClientId if for any reason the
        // picker dropped it (shouldn't happen — every Job has a co).
        companyId = job.company?.id ?? selectedClientId;
      } else {
        // Resolve / create company
        let finalClientId = selectedClientId;
        if (selectedClientId === '__new__' && parsed?.clientName) {
          const coRes = await fetch('/api/crm/companies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: parsed.clientName,
              tier: 'NEW',
              billingEmail: parsed?.contactEmail || null,
            }),
          });
          if (!coRes.ok) { alert('Failed to create new company'); setCreating(false); return; }
          const co = await coRes.json();
          finalClientId = co.id;
        }
        companyId = finalClientId;

        // Materialize Person rows for any new/create_new contacts before
        // calling POST /api/orders (the inline job payload needs Person
        // IDs). Existing matches and "merge" decisions reuse the
        // existing Person ID; their CRM records are never modified.
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
                console.warn('[new-quote] failed to create person for', c.email);
              }
            } catch (err) {
              console.warn('[new-quote] person create network error:', err);
            }
          }
          if (personId) {
            jobContacts.push({ personId, role: c.role, isPrimary: false });
          }
        }

        inlineJob = {
          name: job.name.trim(),
          productionType: newJobProductionType,
          productionTypeProfileId: newJobProductionTypeProfileId,
          startDate: editing.startDate || null,
          endDate: editing.endDate || null,
          notes: newJobNotes.trim() || null,
          contacts: jobContacts,
        };
      }

      // Single POST creates Order — and (when inlineJob is set) the Job
      // too, inside one Prisma transaction. If anything fails between
      // them, nothing persists. An abandoned quote that never clicks
      // Save creates nothing at all (the prior flow created the Job
      // eagerly before the Order).
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          ...(existingJobId ? { jobId: existingJobId } : { job: inlineJob }),
          // Unified job control: the picker's `name` is the source of
          // truth for both the Job (when creating new) and the Order's
          // description. Falls back to the agent's notes or a generic
          // label so saved orders always have something readable.
          description: job.name?.trim() || editing.productionName?.trim() || editing.notes || 'Quote from AI extraction',
          startDate: editing.startDate || null,
          endDate: editing.endDate || null,
          notes: editing.notes || null,
          taxRate: 0,
          agentId: (session?.user as { id?: string })?.id,
        }),
      });
      if (!orderRes.ok) {
        const err = await orderRes.json();
        alert(err.error || 'Failed to create order');
        setCreating(false);
        return;
      }
      const order = await orderRes.json();
      // jobId for downstream inquiry-PATCH — comes from either the
      // existing job we attached to or the newly-created one.
      const jobId: string = existingJobId ?? order.createdJobId ?? order.jobId;

      // Add line items (already pruned of trailing empty rows).
      // Package metadata (instanceId / header flag / packageId / modified
      // flag) ride along on each row — the API stores them verbatim so
      // member grouping survives a page reload.
      for (const it of itemsForSave) {
        const liType = it.catalogType === 'ASSET_CATEGORY'
          ? 'VEHICLE'
          : it.catalogType === 'PACKAGE'
            ? 'EQUIPMENT' // package header is treated as equipment for lane routing
            : it.department === 'EXPENDABLES'
              ? 'EXPENDABLE'
              : 'EQUIPMENT';
        await fetch(`/api/orders/${order.id}/line-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: liType,
            description: it.description,
            // Header rows don't carry an inventoryItemId (the catalog
            // type is PACKAGE); only INVENTORY-typed children + true
            // inventory matches do.
            inventoryItemId: it.catalogType === 'INVENTORY' ? it.catalogProductId : null,
            assetCategoryId: it.catalogType === 'ASSET_CATEGORY' ? it.catalogProductId : null,
            department: it.department,
            qualifier: it.qualifier || null,
            quantity: it.quantity,
            rate: it.rate,
            rateType: it.rateType,
            pickupDate: it.pickupDate,
            returnDate: it.returnDate,
            billableDays: it.billableDays,
            packageInstanceId: it.packageInstanceId ?? null,
            packageId: it.packageId ?? null,
            isPackageHeader: !!it.isPackageHeader,
            isPackageModified: !!it.isPackageModified,
          }),
        });
      }

      if (discountAmount && parseFloat(discountAmount) !== 0) {
        await fetch(`/api/orders/${order.id}/line-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'DISCOUNT',
            description: discountLabel || 'Discount',
            quantity: 1,
            rate: parseFloat(discountAmount),
            rateType: 'FLAT',
            department: 'PRO_SUPPLIES',
          }),
        });
      }

      // Mark inquiry CONVERTED if we came from one (and we created a
      // new Job — attaching to an existing Job means the Inquiry was
      // serving a different purpose, leave its status alone).
      if (inquiry && job.mode === 'creating_new') {
        try {
          await fetch(`/api/inquiries/${inquiry.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'CONVERTED', convertedJobId: jobId }),
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
        console.warn('[new-quote] quote PDF generation failed (non-fatal):', err);
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

      // The capture is now persisted as an Order, so the CRM-return
      // draft snapshot is no longer needed. Clearing prevents stale
      // restoration on a future /orders/new-quote visit.
      clearDraftState(inquiryId);

      router.push(action === 'send' ? `/orders/${order.id}?send=1` : `/orders/${order.id}`);
    } finally {
      setCreating(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────

  // Step 1: Input
  if (!parsed && items.length === 0) {
    return (
      <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
        <div className="max-w-3xl mx-auto space-y-4">
        <button onClick={() => router.push('/orders')} className="text-sm text-lt-fg3 hover:text-lt-fg">
          &larr; Back to Orders
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-lt-fg">New Quote</h1>
          <p className="text-sm text-lt-fg2 mt-1">
            Paste an email or upload a PDF. AI extracts line items + matches them against the catalog.
          </p>
        </div>

        {inquiry && (
          <div className="bg-chip-good-bg text-chip-good-fg border border-chip-good-fg/30 rounded-xl p-3 text-[12px] flex items-center justify-between gap-3">
            <span>
              Created from Inquiry: <span className="font-semibold text-chip-good-fg">{inquiry.title}</span>
              {inquiry.company && <> · <span className="font-semibold text-chip-good-fg">{inquiry.company.name}</span></>}
            </span>
            <a
              href={`/inquiries/${inquiry.id}`}
              className="font-semibold text-chip-good-fg hover:opacity-80 hover:underline whitespace-nowrap"
            >
              View original →
            </a>
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
              className="w-full py-3 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white font-medium rounded-lg"
            >
              {parsing ? 'AI is parsing…' : 'Parse with AI'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-lt-fg2 file:mr-4 file:py-3 file:px-4 file:rounded-lg file:border-0 file:bg-lt-inner file:text-lt-fg file:cursor-pointer hover:file:bg-lt-inner"
            />
            {pdfFile && <p className="text-sm text-lt-fg2">{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</p>}
            <button
              onClick={parsePDF}
              disabled={!pdfFile || parsing}
              className="w-full py-3 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white font-medium rounded-lg"
            >
              {parsing ? 'AI is processing PDF…' : 'Upload & Parse'}
            </button>
          </div>
        )}

        <button onClick={addBlankItem} className="text-xs text-lt-fg3 hover:text-lt-fg2 underline">
          Or skip parsing and add line items manually
        </button>
        </div>
      </div>
    );
  }

  // Step 2: Review
  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-5xl mx-auto space-y-4">
      <button onClick={() => { setParsed(null); setItems([]); }} className="text-sm text-lt-fg3 hover:text-lt-fg">
        &larr; Start Over
      </button>
      {inquiry && (
        <div className="text-[11.5px] text-lt-fg3">
          Created from Inquiry: <span className="text-lt-fg3 font-medium">{inquiry.title}</span>
          {' · '}
          <a href={`/inquiries/${inquiry.id}`} className="text-lt-fg3 hover:text-lt-fg hover:underline">
            View original →
          </a>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold text-lt-fg">Review Quote</h1>
        <p className="text-sm text-lt-fg2 mt-1">
          Adjust each line item. Departments, rates, and rate-types are editable per row.
        </p>
      </div>

      {/* Header context — editable client/dates extracted by the AI. */}
      {(
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-3">
          <div>
            <label className="block text-xs text-lt-fg3 mb-1">Client Company</label>
            {clientCandidates.length > 0 ? (
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
              >
                <option value="">— Select a match —</option>
                {clientCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.tier !== 'STANDARD' ? `(${c.tier})` : ''} {c.coiOnFile ? '| COI' : ''}
                  </option>
                ))}
                {parsed?.clientName && (
                  <option value="__new__">+ Create new company: {parsed.clientName}</option>
                )}
              </select>
            ) : inquiry?.company ? (
              <div className="text-sm text-lt-fg2">{inquiry.company.name}</div>
            ) : (
              <div className="text-sm text-chip-warn-fg bg-chip-warn-bg border border-chip-warn-fg/30 rounded-lg p-3">
                No client extracted.{' '}
                <button
                  type="button"
                  onClick={() => {
                    // Snapshot the post-parse state to sessionStorage so
                    // it's restored when the user returns from /crm.
                    // Without this, the page remounts and Review Quote
                    // re-renders as the pre-parse input page.
                    saveDraftState(inquiry?.id ?? null, {
                      parsed,
                      items,
                      editing,
                      selectedClientId,
                      contacts,
                      emailText,
                      job,
                      candidateJobs,
                      discountAmount,
                      discountLabel,
                      newJobProductionType,
                      newJobProductionTypeProfileId,
                      newJobNotes,
                    });
                    const params = new URLSearchParams();
                    params.set('selectForQuote', '1');
                    if (inquiry?.id) params.set('inquiryId', inquiry.id);
                    router.push(`/crm?${params.toString()}`);
                  }}
                  className="underline font-semibold text-chip-warn-fg hover:opacity-80"
                >
                  Pick one in CRM
                </button>
                .
              </div>
            )}
            {parsed?.clientName && (
              <p className="text-xs text-lt-fg3 mt-1">AI extracted: <span className="text-lt-fg2">{parsed.clientName}</span></p>
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
              <p className="text-[11px] text-lt-fg3">
                {candidateJobs.length > 0
                  ? `${candidateJobs.length} existing Job${candidateJobs.length === 1 ? '' : 's'} for this client — pick one, or type a new name.`
                  : selectedClientId && selectedClientId !== '__new__'
                    ? 'No matching Jobs — typing creates a new one on save.'
                    : 'Pick a Client Company first to surface matching Jobs.'}
              </p>
            </div>
            <JobPicker
              value={job}
              onChange={setJob}
              companyId={selectedClientId && selectedClientId !== '__new__' ? selectedClientId : null}
              placeholder={
                job.name
                  ? `Search jobs by name or code…`
                  : 'Search by job name or code, or type a new name…'
              }
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
                                {new Date(j.startDate).toLocaleDateString()}
                                {j.endDate ? ` → ${new Date(j.endDate).toLocaleDateString()}` : ''}
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

          <div className="grid grid-cols-2 gap-3">
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
        </div>
      )}

      {/* Job control + recommendations + new-job details now live
          inline in the Client Company card above — no separate
          "Job for this Quote" section. */}

      {/* People on this thread (AI-extracted contacts, human review) */}
      <PeopleSection contacts={contacts} setContacts={setContacts} />

      {/* Line items grouped by department */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-lt-fg">Line Items ({items.length})</h2>
          <button onClick={addBlankItem} className="text-[11px] font-semibold text-lt-fg2 hover:text-lt-fg">
            + Add line manually
          </button>
        </div>
        {items.length === 0 ? (
          <div className="text-xs text-lt-fg3 text-center py-6">No line items.</div>
        ) : (
          DEPARTMENTS.map((dept) => {
            const group = items
              .map((it, idx) => ({ it, idx }))
              .filter(({ it }) => it.department === dept);
            if (group.length === 0) return null;
            return (
              <DepartmentGroup
                key={dept}
                department={dept}
                rows={group}
                onChange={updateItem}
                onDelete={removeItem}
                onBulkApply={setBulkForDept}
                onCommit={handleRowCommit}
                onPickPackage={handlePickPackage}
                registerDescriptionRef={registerDescriptionRef}
              />
            );
          })
        )}
      </div>

      {/* Discount */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-lt-fg3 font-bold">Discount (optional)</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-lt-fg3 mb-1">Label</label>
            <input
              type="text" value={discountLabel}
              onChange={(e) => setDiscountLabel(e.target.value)}
              placeholder="e.g. Loyalty discount"
              className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
            />
          </div>
          <div>
            <label className="block text-xs text-lt-fg3 mb-1">Amount (negative)</label>
            <CurrencyInput
              value={Number(discountAmount) || 0}
              onChange={(next) => setDiscountAmount(next === 0 ? '' : String(next))}
              placeholder="-500.00"
              inputClassName="px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg font-mono"
              ariaLabel="Discount amount"
            />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span className="text-lt-fg3">Subtotal:</span>
          <span className="ml-2 font-mono text-lt-fg text-base">{fmtMoney(orderTotal)}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setParsed(null); setItems([]); }}
            className="px-4 py-2 text-sm text-lt-fg2 hover:text-lt-fg"
          >
            Cancel
          </button>
          <button
            onClick={() => createQuote('download')}
            disabled={!canCreate || creating}
            className="px-4 py-2 bg-lt-inner hover:bg-lt-hairline disabled:opacity-50 text-lt-fg text-sm font-semibold rounded-lg"
            title="Save as draft and download the PDF"
          >
            {creating ? 'Saving…' : 'Download PDF'}
          </button>
          <button
            onClick={() => createQuote('preview')}
            disabled={!canCreate || creating}
            className="px-4 py-2 bg-lt-inner hover:bg-lt-hairline disabled:opacity-50 text-lt-fg text-sm font-semibold rounded-lg"
            title="Save as draft and open the PDF in a new tab"
          >
            {creating ? 'Saving…' : 'Preview PDF'}
          </button>
          <button
            onClick={() => createQuote('draft')}
            disabled={!canCreate || creating}
            className="px-5 py-2 bg-lt-inner hover:bg-lt-hairline disabled:opacity-50 text-lt-fg text-sm font-semibold rounded-lg"
            title="Save as draft and open the order detail page"
          >
            {creating ? 'Saving Draft…' : 'Save Draft'}
          </button>
          <button
            onClick={() => createQuote('send')}
            disabled={!canCreate || creating}
            className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg"
            title="Create the quote, generate the PDF, then open the TSX welcome+quote review gate"
          >
            {creating ? 'Saving…' : 'Send quote →'}
          </button>
        </div>
      </div>

      <LineItemUndoToast toast={undoToast} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────


// Shared grid template for the dept-group "table" — header row, line item
// rows, and subtotal row all use this so columns align vertically.
//   QTY · DESCRIPTION · PRICE/DAY · PICKUP · RETURN · DAYS · TOTAL · ACTIONS
const TABLE_GRID = 'grid-cols-[64px_minmax(280px,1fr)_90px_140px_140px_72px_90px_36px]';

function DepartmentGroup({
  department, rows, onChange, onDelete, onBulkApply, onCommit, onPickPackage, registerDescriptionRef,
}: {
  department: LineItemDepartment;
  rows: { it: ResolvedItem; idx: number }[];
  onChange: (idx: number, patch: Partial<ResolvedItem>) => void;
  onDelete: (idx: number) => void;
  onBulkApply: (
    dept: LineItemDepartment,
    patch: { pickupDate?: string; returnDate?: string; billableDays?: number },
  ) => void;
  onCommit?: (idx: number) => void;
  onPickPackage?: (idx: number, hit: import('@/components/orders/LineItemDescriptionCombobox').CatalogHit) => void;
  registerDescriptionRef?: (idx: number) => (el: HTMLInputElement | null) => void;
}) {
  const [bulkPickup, setBulkPickup] = useState('');
  const [bulkReturn, setBulkReturn] = useState('');
  const [bulkDays, setBulkDays] = useState('');
  const [appliedFlash, setAppliedFlash] = useState(false);
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
    (sum, { it }) =>
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
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${DEPT_BADGE[department]}`}>
            {DEPARTMENT_SHORT[department]}
          </span>
          <span className="text-[11px] text-lt-fg font-semibold">{DEPARTMENT_LABEL[department].toUpperCase()}</span>
          <span className="text-[10px] text-lt-fg3">· {rows.length} item{rows.length === 1 ? '' : 's'}</span>
        </div>
        {showBulk && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-lt-fg3">Apply to category:</span>
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
              <span className="text-[10px] font-semibold text-chip-good-fg ml-1">Applied ✓</span>
            )}
          </div>
        )}
      </header>

      {/* Column header row — same grid as item rows so columns align across
          groups. EXPENDABLES are consumed/sold (not rented), so Pickup /
          Return / Billable-days don't apply — header labels in those
          columns are suppressed and the row cells render an em-dash. */}
      <div className={`grid ${TABLE_GRID} gap-2 px-3 py-1.5 bg-lt-card/40 border-b border-lt-hairline text-[9px] uppercase tracking-wider text-lt-fg3 font-bold items-center`}>
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
        {rows.map(({ it, idx }) => (
          <LineItemRow
            key={idx}
            item={it}
            idx={idx}
            onChange={onChange}
            onDelete={onDelete}
            onCommit={onCommit}
            onPickPackage={onPickPackage}
            descriptionRef={registerDescriptionRef?.(idx)}
          />
        ))}
      </div>

      {/* Subtotal row */}
      <div className={`grid ${TABLE_GRID} gap-2 px-3 py-2 bg-lt-card/40 border-t border-lt-hairline text-[11px] text-lt-fg2 items-center`}>
        <div className="col-span-6 font-semibold uppercase tracking-wider text-[10px]">Subtotal</div>
        <div className="text-right font-mono text-chip-good-fg text-sm">{fmtMoney(subtotal)}</div>
        <div></div>
      </div>
    </section>
  );
}

function LineItemRow({
  item, idx, onChange, onDelete, onCommit, onPickPackage, descriptionRef,
}: {
  item: ResolvedItem;
  idx: number;
  onChange: (idx: number, patch: Partial<ResolvedItem>) => void;
  onDelete: (idx: number) => void;
  /** Parent-level commit: auto-append empty row + focus its
   *  description input when this row's combobox emits commit. */
  onCommit?: (idx: number) => void;
  /** Package pick handler — escapes the per-row patch to insert
   *  header + member rows at the parent level. */
  onPickPackage?: (idx: number, hit: import('@/components/orders/LineItemDescriptionCombobox').CatalogHit) => void;
  /** Ref the parent passes for the row's description input so the
   *  next-row auto-append can move focus. */
  descriptionRef?: React.Ref<HTMLInputElement>;
}) {

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
      onPickPackage(idx, m as unknown as import('@/components/orders/LineItemDescriptionCombobox').CatalogHit);
      return;
    }
    onChange(idx, {
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
        {/* QTY */}
        <input
          type="number" min={1} step={1} value={item.quantity}
          onChange={(e) => onChange(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })}
          className="w-full bg-lt-card border border-lt-hairline rounded px-2 py-1 text-sm text-lt-fg font-mono"
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
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <LineItemDescriptionCombobox
                value={item.description}
                onChange={(next) => onChange(idx, { description: next })}
                onPickCatalog={(hit) => applyMatch(hit as CatalogSearchResult)}
                catalogBinding={
                  item.catalogProductId && item.matchedProduct
                    ? { id: item.catalogProductId, type: item.matchedProduct.type, name: item.matchedProduct.name }
                    : null
                }
                onClearCatalog={() =>
                  onChange(idx, {
                    catalogProductId: null,
                    catalogType: null,
                    matchedProduct: null,
                    matchSource: null,
                  })
                }
                onCommit={() => onCommit?.(idx)}
                ref={descriptionRef}
                placeholder="New line item — type to search inventory"
              />
            </div>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0 ${DEPT_BADGE[item.department]}`}
              title={DEPARTMENT_LABEL[item.department]}
            >
              {DEPARTMENT_SHORT[item.department]}
            </span>
          </div>
          {item.qualifier && (
            <div className="text-[11px] text-lt-fg2 italic">— {item.qualifier}</div>
          )}
        </div>

        {/* PRICE/DAY */}
        <CurrencyInput
          value={item.rate}
          onChange={(next) => onChange(idx, { rate: next })}
          min={0}
          inputClassName="bg-lt-card border border-lt-hairline rounded px-2 py-1 text-sm text-lt-fg font-mono"
          ariaLabel="Price per day"
        />

        {/* PICKUP */}
        {isExpendable ? (
          <div className="text-center text-sm self-center">{dash}</div>
        ) : (
          <input
            type="date" value={item.pickupDate}
            onChange={(e) => onChange(idx, { pickupDate: e.target.value })}
            className="w-full bg-lt-card border border-lt-hairline rounded px-2 py-1 text-[11px] text-lt-fg"
          />
        )}

        {/* RETURN */}
        {isExpendable ? (
          <div className="text-center text-sm self-center">{dash}</div>
        ) : (
          <input
            type="date" value={item.returnDate}
            onChange={(e) => onChange(idx, { returnDate: e.target.value })}
            className="w-full bg-lt-card border border-lt-hairline rounded px-2 py-1 text-[11px] text-lt-fg"
          />
        )}

        {/* BILLABLE DAYS — input + (STAGES) inline rate-type toggle below */}
        {isExpendable ? (
          <div className="text-center text-sm self-center">{dash}</div>
        ) : (
          <div className="space-y-1">
            <input
              type="number" min={1} step={1} value={item.billableDays}
              onChange={(e) => onChange(idx, { billableDays: Math.max(1, Number(e.target.value) || 1) })}
              className="w-full bg-lt-card border border-lt-hairline rounded px-1 py-1 text-sm text-lt-fg font-mono text-center"
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
                      onClick={() => enabled && onChange(idx, { rateType: rt })}
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

        {/* TOTAL */}
        <div className="text-right text-sm font-mono text-chip-good-fg self-center pt-1">
          {fmtMoney(total)}
        </div>

        {/* ACTIONS — new-quote keeps its bespoke kebab with the
            inline department-edit select. /orders/[id] uses the shared
            <LineItemRowActions> with just the standardized
            "Remove line item" affordance. Same red destructive label
            on both, same kebab glyph — only this surface adds the
            inline dept-edit on top. Full extraction lands in a
            follow-up commit. */}
        <div className="self-center">
          <RowActionsMenu
            currentDepartment={item.department}
            onChangeDepartment={(d) => onChange(idx, { department: d })}
            onDelete={() => onDelete(idx)}
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
  existing:        { label: '✓ Existing',      cls: 'bg-chip-good-bg text-chip-good-fg border-chip-good-fg/30' },
  new:             { label: '✚ New',           cls: 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30' },
  possible_match:  { label: '? Possible match', cls: 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30' },
};

const SOURCE_LABEL: Record<ContactSource, string> = {
  header:        'from header',
  signature:     'from signature',
  body_mention:  'mentioned in body',
};

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
                  <div className="grid grid-cols-2 gap-2 mt-2">
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
                      placeholder="Title"
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
                  <div className="flex items-center gap-3 mt-2">
                    <label className="text-[10px] text-lt-fg3 uppercase tracking-wider">Role</label>
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

