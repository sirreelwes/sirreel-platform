'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { LineItemDepartment, ProductionType, RateType } from '@prisma/client';
import { JobPicker, EMPTY_JOB_PICKER_VALUE, type JobPickerValue } from '@/components/shared/JobPicker';

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

type CatalogType = 'INVENTORY' | 'ASSET_CATEGORY';

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
}

// pickRate is used when applying a catalog match to seed the line's rate.
// Most InventoryItems only have weeklyRate populated, so derive the missing
// side using a 5-day work-week assumption.
function pickRate(p: { dailyRate: number; weeklyRate: number }, rt: RateType): number {
  if (rt === 'WEEKLY' || rt === 'MONTHLY') return p.weeklyRate > 0 ? p.weeklyRate : p.dailyRate * 5;
  return p.dailyRate > 0 ? p.dailyRate : p.weeklyRate / 5;
}

const DEPT_BADGE: Record<LineItemDepartment, string> = {
  VEHICLES:       'bg-sky-900/40 text-sky-300 border-sky-800',
  COMMUNICATIONS: 'bg-violet-900/40 text-violet-300 border-violet-800',
  STAGES:         'bg-fuchsia-900/40 text-fuchsia-300 border-fuchsia-800',
  GE:             'bg-amber-900/40 text-amber-300 border-amber-800',
  EXPENDABLES:    'bg-orange-900/40 text-orange-300 border-orange-800',
  PRO_SUPPLIES:   'bg-zinc-800 text-zinc-300 border-zinc-700',
  ART:            'bg-pink-900/40 text-pink-300 border-pink-800',
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
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
    <Suspense fallback={<div className="p-6 text-sm text-zinc-400">Loading…</div>}>
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
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
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
      }),
    );
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
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
        description: 'New line item',
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
  // All three persist as quoteStatus=DRAFT (schema default). The detail
  // page is the canonical place to iterate; preview/download navigate
  // there afterward so the agent never edits in two places.
  type CreateAction = 'draft' | 'preview' | 'download';

  const createQuote = async (action: CreateAction = 'draft') => {
    if (!canCreate) return;
    setCreating(true);
    try {
      let companyId: string;
      let inlineJob: {
        name: string;
        productionType: ProductionType;
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
            try {
              const personRes = await fetch('/api/crm/people', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  firstName,
                  lastName,
                  email: c.email,
                  phone: c.phone || undefined,
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
          description: editing.productionName || editing.notes || 'Quote from AI extraction',
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

      // Add line items
      for (const it of items) {
        const liType = it.catalogType === 'ASSET_CATEGORY'
          ? 'VEHICLE'
          : it.department === 'EXPENDABLES'
            ? 'EXPENDABLE'
            : 'EQUIPMENT';
        await fetch(`/api/orders/${order.id}/line-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: liType,
            description: it.description,
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

      router.push(`/orders/${order.id}`);
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
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <button onClick={() => router.push('/orders')} className="text-sm text-gray-500 hover:text-gray-900">
          &larr; Back to Orders
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">New Quote</h1>
          <p className="text-sm text-gray-600 mt-1">
            Paste an email or upload a PDF. AI extracts line items + matches them against the catalog.
          </p>
        </div>

        {inquiry && (
          <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl p-3 text-[12px]">
            Prefilled from Inquiry: <span className="font-semibold text-emerald-900">{inquiry.title}</span>
            {inquiry.company && <> · <span className="font-semibold text-emerald-900">{inquiry.company.name}</span></>}
          </div>
        )}

        <div className="flex gap-1 bg-zinc-800 rounded-lg p-0.5 w-fit">
          {(['paste', 'pdf'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setInputMode(m)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium ${
                inputMode === m ? 'bg-white text-zinc-900' : 'text-zinc-400 hover:text-white'
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
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 resize-y"
            />
            <button
              onClick={parseEmail}
              disabled={!emailText.trim() || parsing}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white font-medium rounded-lg"
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
              className="block w-full text-sm text-zinc-400 file:mr-4 file:py-3 file:px-4 file:rounded-lg file:border-0 file:bg-zinc-800 file:text-white file:cursor-pointer hover:file:bg-zinc-700"
            />
            {pdfFile && <p className="text-sm text-zinc-400">{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</p>}
            <button
              onClick={parsePDF}
              disabled={!pdfFile || parsing}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white font-medium rounded-lg"
            >
              {parsing ? 'AI is processing PDF…' : 'Upload & Parse'}
            </button>
          </div>
        )}

        <button onClick={addBlankItem} className="text-xs text-zinc-500 hover:text-zinc-300 underline">
          Or skip parsing and add line items manually
        </button>
      </div>
    );
  }

  // Step 2: Review
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <button onClick={() => { setParsed(null); setItems([]); }} className="text-sm text-gray-500 hover:text-gray-900">
        &larr; Start Over
      </button>
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Review Quote</h1>
        <p className="text-sm text-gray-600 mt-1">
          Adjust each line item. Departments, rates, and rate-types are editable per row.
        </p>
      </div>

      {/* Header context — editable client/dates extracted by the AI. */}
      {(
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Client Company</label>
            {clientCandidates.length > 0 ? (
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
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
              <div className="text-sm text-zinc-300">{inquiry.company.name}</div>
            ) : (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
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
                      newJobNotes,
                    });
                    const params = new URLSearchParams();
                    params.set('selectForQuote', '1');
                    if (inquiry?.id) params.set('inquiryId', inquiry.id);
                    router.push(`/crm?${params.toString()}`);
                  }}
                  className="underline font-semibold text-amber-800 hover:text-amber-900"
                >
                  Pick one in CRM
                </button>
                .
              </div>
            )}
            {parsed?.clientName && (
              <p className="text-xs text-zinc-500 mt-1">AI extracted: <span className="text-zinc-300">{parsed.clientName}</span></p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Job Name</label>
              <input
                type="text" value={editing.productionName || ''}
                onChange={(e) => setEditing({ ...editing, productionName: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Pickup Date</label>
              <input
                type="date" value={editing.startDate || ''}
                onChange={(e) => updateQuoteDate('startDate', e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Return Date</label>
              <input
                type="date" value={editing.endDate || ''}
                onChange={(e) => updateQuoteDate('endDate', e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* Job for this Quote — uses the shared <JobPicker> (same
          component as the +Hold modal). The recommendations panel
          above it surfaces this client's date-relevant Jobs without
          requiring the user to type. Pick-existing stays prominent;
          create-new path lives in the picker dropdown + the inline
          details block that appears below when creating_new fires. */}
      <JobQuoteSection
        job={job}
        setJob={setJob}
        candidates={candidateJobs}
        selectedClientId={selectedClientId}
        newJobProductionType={newJobProductionType}
        setNewJobProductionType={setNewJobProductionType}
        newJobNotes={newJobNotes}
        setNewJobNotes={setNewJobNotes}
        seedName={editing.productionName || parsed?.productionName || inquiry?.title || ''}
      />

      {/* People on this thread (AI-extracted contacts, human review) */}
      <PeopleSection contacts={contacts} setContacts={setContacts} />

      {/* Line items grouped by department */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Line Items ({items.length})</h2>
          <button onClick={addBlankItem} className="text-[11px] font-semibold text-zinc-400 hover:text-white">
            + Add line manually
          </button>
        </div>
        {items.length === 0 ? (
          <div className="text-xs text-zinc-600 text-center py-6">No line items.</div>
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
              />
            );
          })
        )}
      </div>

      {/* Discount */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">Discount (optional)</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Label</label>
            <input
              type="text" value={discountLabel}
              onChange={(e) => setDiscountLabel(e.target.value)}
              placeholder="e.g. Loyalty discount"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Amount (negative)</label>
            <input
              type="number" step="0.01" value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="-500"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white font-mono"
            />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span className="text-zinc-500">Subtotal:</span>
          <span className="ml-2 font-mono text-white text-base">{fmtMoney(orderTotal)}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setParsed(null); setItems([]); }}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => createQuote('download')}
            disabled={!canCreate || creating}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
            title="Save as draft and download the PDF"
          >
            {creating ? 'Saving…' : 'Download PDF'}
          </button>
          <button
            onClick={() => createQuote('preview')}
            disabled={!canCreate || creating}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
            title="Save as draft and open the PDF in a new tab"
          >
            {creating ? 'Saving…' : 'Preview PDF'}
          </button>
          <button
            onClick={() => createQuote('draft')}
            disabled={!canCreate || creating}
            className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 text-white text-sm font-bold rounded-lg"
            title="Save as draft and open the order detail page"
          >
            {creating ? 'Saving Draft…' : 'Save Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

// Wraps the shared <JobPicker> with a parent-specific top panel:
// (1) a "Recommended candidates" list that surfaces this client's
// date-relevant open Jobs without forcing the user to type, and
// (2) an inline "New job details" block (productionType + notes)
// that appears only when the picker enters `creating_new` mode.
//
// The picker is the canonical control — same component used by the
// +Hold modal — so search-or-create semantics live there. This
// component only adds the recommendation-discovery surface and the
// new-Job extra fields that JobPicker intentionally doesn't carry.
function JobQuoteSection({
  job,
  setJob,
  candidates,
  selectedClientId,
  newJobProductionType,
  setNewJobProductionType,
  newJobNotes,
  setNewJobNotes,
  seedName,
}: {
  job: JobPickerValue;
  setJob: (v: JobPickerValue) => void;
  candidates: AttachableJob[];
  selectedClientId: string;
  newJobProductionType: ProductionType;
  setNewJobProductionType: (pt: ProductionType) => void;
  newJobNotes: string;
  setNewJobNotes: (notes: string) => void;
  seedName: string;
}) {
  // Sort candidates: most recent first; top one gets the Recommended badge.
  const sortedCandidates = [...candidates].sort((a, b) => {
    const aT = a.startDate ? new Date(a.startDate).getTime() : 0;
    const bT = b.startDate ? new Date(b.startDate).getTime() : 0;
    return bT - aT;
  });
  const hasCandidates = sortedCandidates.length > 0;
  const recommendedId = hasCandidates ? sortedCandidates[0].id : null;
  // The recommendations panel only shows when the user hasn't yet
  // committed to a Job (either by picking one or starting a new one).
  // After commit, the JobPicker pill is the source of truth.
  const showRecommendations = hasCandidates && job.mode === 'searching';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold text-white">Job for this Quote</h2>
        <p className="text-[11px] text-zinc-500">
          {hasCandidates
            ? `${sortedCandidates.length} existing Job${sortedCandidates.length === 1 ? '' : 's'} for this client — attach to one, or search/create below.`
            : selectedClientId
              ? 'No matching Jobs found — search below or start a new one.'
              : 'Pick a Client Company above to see matching Jobs.'}
        </p>
      </div>

      {showRecommendations && (
        <div className="space-y-1.5">
          {sortedCandidates.map((j) => {
            const orders = j._count?.orders ?? 0;
            const recommended = j.id === recommendedId;
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
                className="w-full text-left rounded-lg border px-3 py-2 bg-zinc-900/60 border-zinc-700 hover:bg-zinc-800/60 transition-colors flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-[13px] font-semibold text-white truncate">
                      [{j.jobCode}] {j.name}
                    </div>
                    {recommended && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-800">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
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

      {/* Always available — search across the client's open Jobs and
          a fallback create-new path for unmatched names. The picker
          ships in light-theme palette (it's also used outside this
          dark surface); the surrounding card frames it. */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
          {hasCandidates ? 'Or search / create new' : 'Search or create new'}
        </div>
        <JobPicker
          value={job}
          onChange={setJob}
          companyId={selectedClientId || null}
          placeholder={
            seedName
              ? `Type to search — try "${seedName.slice(0, 40)}${seedName.length > 40 ? '…' : ''}"`
              : 'Search by job name or code, or type a new name…'
          }
        />
      </div>

      {job.mode === 'creating_new' && (
        <div className="rounded-lg border border-amber-700 bg-amber-900/20 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-amber-300 font-bold">
            New job details
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Production type</label>
            <select
              value={newJobProductionType}
              onChange={(e) => setNewJobProductionType(e.target.value as ProductionType)}
              className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-[12px] text-white"
            >
              {PRODUCTION_TYPES.map((pt) => (
                <option key={pt} value={pt}>{PRODUCTION_TYPE_LABEL[pt]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Notes (optional)</label>
            <textarea
              value={newJobNotes}
              onChange={(e) => setNewJobNotes(e.target.value)}
              rows={2}
              placeholder="Context, client preferences, deal notes…"
              className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-[12px] text-white resize-y"
            />
          </div>
          <p className="text-[10px] text-zinc-500">
            Job + Order are created together when you Save Draft — nothing is written until then.
          </p>
        </div>
      )}
    </div>
  );
}

// Shared grid template for the dept-group "table" — header row, line item
// rows, and subtotal row all use this so columns align vertically.
//   QTY · DESCRIPTION · PRICE/DAY · PICKUP · RETURN · DAYS · TOTAL · ACTIONS
const TABLE_GRID = 'grid-cols-[64px_minmax(220px,1fr)_96px_136px_136px_120px_104px_36px]';

function DepartmentGroup({
  department, rows, onChange, onDelete, onBulkApply,
}: {
  department: LineItemDepartment;
  rows: { it: ResolvedItem; idx: number }[];
  onChange: (idx: number, patch: Partial<ResolvedItem>) => void;
  onDelete: (idx: number) => void;
  onBulkApply: (
    dept: LineItemDepartment,
    patch: { pickupDate?: string; returnDate?: string; billableDays?: number },
  ) => void;
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
    <section className="border border-zinc-800 rounded-lg overflow-x-auto">
      {/* Group header — dept name + count + bulk-set strip */}
      <header className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-900/60 border-b border-zinc-800 rounded-t-lg flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${DEPT_BADGE[department]}`}>
            {DEPARTMENT_SHORT[department]}
          </span>
          <span className="text-[11px] text-zinc-200 font-semibold">{DEPARTMENT_LABEL[department].toUpperCase()}</span>
          <span className="text-[10px] text-zinc-500">· {rows.length} item{rows.length === 1 ? '' : 's'}</span>
        </div>
        {showBulk && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-zinc-500">Apply to category:</span>
            <input
              type="date" value={bulkPickup}
              onChange={(e) => setBulkPickup(e.target.value)}
              title="Pickup"
              className="w-32 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-white"
            />
            <input
              type="date" value={bulkReturn}
              onChange={(e) => setBulkReturn(e.target.value)}
              title="Return"
              className="w-32 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-white"
            />
            <input
              type="number" min={1} step={1} value={bulkDays}
              onChange={(e) => setBulkDays(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              placeholder="Days"
              title="Billable days"
              className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-white font-mono"
            />
            <button
              onClick={apply}
              disabled={!bulkPickup && !bulkReturn && !bulkDays}
              className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-[10px] font-bold rounded"
            >
              Apply
            </button>
            {appliedFlash && (
              <span className="text-[10px] font-semibold text-emerald-400 ml-1">Applied ✓</span>
            )}
          </div>
        )}
      </header>

      {/* Column header row — same grid as item rows so columns align across
          groups. EXPENDABLES are consumed/sold (not rented), so Pickup /
          Return / Billable-days don't apply — header labels in those
          columns are suppressed and the row cells render an em-dash. */}
      <div className={`grid ${TABLE_GRID} gap-2 px-3 py-1.5 bg-zinc-900/40 border-b border-zinc-800 text-[9px] uppercase tracking-wider text-zinc-500 font-bold items-center`}>
        <div>Qty</div>
        <div>Description</div>
        <div>{isExpendable ? 'Price' : 'Price/day'}</div>
        <div>{isExpendable ? '' : 'Pickup'}</div>
        <div>{isExpendable ? '' : 'Return'}</div>
        <div>{isExpendable ? '' : 'Billable days'}</div>
        <div className="text-right">Total</div>
        <div></div>
      </div>

      {/* Line item rows */}
      <div className="divide-y divide-zinc-800/60">
        {rows.map(({ it, idx }) => (
          <LineItemRow key={idx} item={it} idx={idx} onChange={onChange} onDelete={onDelete} />
        ))}
      </div>

      {/* Subtotal row */}
      <div className={`grid ${TABLE_GRID} gap-2 px-3 py-2 bg-zinc-900/40 border-t border-zinc-800 text-[11px] text-zinc-400 items-center`}>
        <div className="col-span-6 font-semibold uppercase tracking-wider text-[10px]">Subtotal</div>
        <div className="text-right font-mono text-emerald-400 text-sm">{fmtMoney(subtotal)}</div>
        <div></div>
      </div>
    </section>
  );
}

function LineItemRow({
  item, idx, onChange, onDelete,
}: {
  item: ResolvedItem;
  idx: number;
  onChange: (idx: number, patch: Partial<ResolvedItem>) => void;
  onDelete: (idx: number) => void;
}) {
  const [showOverride, setShowOverride] = useState(item.catalogProductId == null);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<CatalogSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (searchQ.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      setSearching(true);
      fetch(`/api/catalog/search?q=${encodeURIComponent(searchQ)}&limit=10`)
        .then((r) => r.json())
        .then((d) => setSearchResults(d.results || []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(t);
  }, [searchQ]);

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
    onChange(idx, {
      catalogProductId: m.id,
      catalogType: m.type,
      department: m.department,
      rate: pickRate(m, item.rateType),
      matchedProduct: { id: m.id, type: m.type, name: m.name },
      matchSource: 'AI',
    });
    setShowOverride(false);
    setSearchQ('');
    setSearchResults([]);
  };

  // Stages discount text — only shown for WEEKLY/MONTHLY since DAILY (and
  // every other dept) is self-explanatory from the columnar values.
  const showStagesDiscountNote =
    item.department === 'STAGES' &&
    (item.rateType === 'WEEKLY' || item.rateType === 'MONTHLY');

  const dash = <span className="text-zinc-700">—</span>;

  return (
    <div className="px-3 py-2 hover:bg-zinc-900/30">
      <div className={`grid ${TABLE_GRID} gap-2 items-start`}>
        {/* QTY */}
        <input
          type="number" min={1} step={1} value={item.quantity}
          onChange={(e) => onChange(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-white font-mono"
        />

        {/* DESCRIPTION column — vertical stack */}
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={item.description}
              onChange={(e) => onChange(idx, { description: e.target.value })}
              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-white font-semibold focus:outline-none focus:border-zinc-600"
            />
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0 ${DEPT_BADGE[item.department]}`}
              title={DEPARTMENT_LABEL[item.department]}
            >
              {DEPARTMENT_SHORT[item.department]}
            </span>
          </div>
          {item.qualifier && (
            <div className="text-[11px] text-zinc-400 italic">— {item.qualifier}</div>
          )}
          {matched ? (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="bg-emerald-900/40 text-emerald-300 px-1.5 py-0.5 rounded font-semibold">
                ✓ Matched: {item.matchedProduct?.name}
              </span>
              <button
                onClick={() => setShowOverride((s) => !s)}
                className="text-zinc-500 hover:text-white underline decoration-dotted"
              >
                Change match
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded font-semibold">
                ⚠ No catalog match
              </span>
              <button
                onClick={() => setShowOverride((s) => !s)}
                className="text-zinc-500 hover:text-white underline decoration-dotted"
              >
                Pick one
              </button>
            </div>
          )}
          {showOverride && (
            <div className="p-2 border border-zinc-800 rounded bg-zinc-900">
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search the catalog…"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[12px] text-white focus:outline-none focus:border-zinc-600"
              />
              {searching && <div className="text-[11px] text-zinc-500 mt-1">Searching…</div>}
              {searchResults.length > 0 && (
                <div className="mt-1.5 max-h-44 overflow-y-auto space-y-0.5">
                  {searchResults.map((r) => (
                    <button
                      key={`${r.type}-${r.id}`}
                      onClick={() => applyMatch(r)}
                      className="block w-full text-left px-2 py-1 hover:bg-zinc-800 rounded text-[11px] text-zinc-300"
                    >
                      <span className="text-zinc-500">[{r.type === 'INVENTORY' ? 'Inv' : 'Fleet'}]</span>{' '}
                      {r.name}
                      <span className="text-zinc-500 ml-2">· {DEPARTMENT_LABEL[r.department]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* PRICE/DAY */}
        <input
          type="number" step="0.50" min={0} value={item.rate}
          onChange={(e) => onChange(idx, { rate: Number(e.target.value) || 0 })}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-white font-mono"
        />

        {/* PICKUP */}
        {isExpendable ? (
          <div className="text-center text-sm self-center">{dash}</div>
        ) : (
          <input
            type="date" value={item.pickupDate}
            onChange={(e) => onChange(idx, { pickupDate: e.target.value })}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white"
          />
        )}

        {/* RETURN */}
        {isExpendable ? (
          <div className="text-center text-sm self-center">{dash}</div>
        ) : (
          <input
            type="date" value={item.returnDate}
            onChange={(e) => onChange(idx, { returnDate: e.target.value })}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white"
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
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-white font-mono"
            />
            {showToggle && (
              <div className="flex bg-zinc-900 border border-zinc-800 rounded p-0.5">
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
                          ? 'bg-amber-600 text-white'
                          : enabled
                            ? 'text-zinc-400 hover:text-white'
                            : 'text-zinc-700 cursor-not-allowed'
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
        <div className="text-right text-sm font-mono text-emerald-400 self-center pt-1">
          {fmtMoney(total)}
        </div>

        {/* ACTIONS */}
        <div className="self-center">
          <RowActionsMenu
            currentDepartment={item.department}
            onChangeDepartment={(d) => onChange(idx, { department: d })}
            onDelete={() => onDelete(idx)}
          />
        </div>
      </div>

      {showStagesDiscountNote && (
        <div className="mt-1 text-[10px] text-zinc-500 leading-tight">{breakdown}</div>
      )}
      {item.rateTypeAutoResetNote && (
        <div className="mt-1 text-[10px] text-amber-400 italic">{item.rateTypeAutoResetNote}</div>
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
        className="px-1 py-0.5 text-zinc-500 hover:text-white text-sm"
        title="Row actions"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 w-48 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg p-1 space-y-0.5">
          {editingDept ? (
            <select
              value={currentDepartment}
              onChange={(e) => {
                onChangeDepartment(e.target.value as LineItemDepartment);
                setEditingDept(false);
                setOpen(false);
              }}
              autoFocus
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-white"
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{DEPARTMENT_LABEL[d]}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingDept(true)}
              className="w-full text-left px-2 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-800 rounded"
            >
              Change department
            </button>
          )}
          <button
            onClick={() => { onDelete(); setOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-[11px] text-red-400 hover:bg-zinc-800 rounded"
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
  existing:        { label: '✓ Existing',      cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-800' },
  new:             { label: '✚ New',           cls: 'bg-sky-900/40 text-sky-300 border-sky-800' },
  possible_match:  { label: '? Possible match', cls: 'bg-amber-900/40 text-amber-300 border-amber-800' },
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
  if (contacts.length === 0) return null;

  const updateContact = (idx: number, patch: Partial<ResolvedContact>) => {
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const includedCount = contacts.filter((c) => c.include).length;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">
          People on this thread ({includedCount} of {contacts.length} selected)
        </h2>
        <p className="text-[11px] text-zinc-500">Will associate with the new Job on save</p>
      </div>
      <div className="space-y-2">
        {contacts.map((c, idx) => {
          const badge = MATCH_BADGE[c.match_status];
          return (
            <div
              key={`${c.email}-${idx}`}
              className={`border rounded-lg p-3 space-y-2 ${
                c.include ? 'bg-zinc-900/60 border-zinc-700' : 'bg-zinc-950/40 border-zinc-800 opacity-70'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={c.include}
                  onChange={(e) => updateContact(idx, { include: e.target.checked })}
                  className="mt-1 h-3.5 w-3.5 accent-amber-500"
                  aria-label={`Include ${c.name || c.email}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="text-[10px] text-zinc-500">· {SOURCE_LABEL[c.source]} ({c.confidence})</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) => updateContact(idx, { name: e.target.value })}
                      placeholder="Name"
                      className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[12px] text-white"
                    />
                    <input
                      type="email"
                      value={c.email}
                      onChange={(e) => updateContact(idx, { email: e.target.value })}
                      placeholder="Email"
                      className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[12px] text-white"
                    />
                    <input
                      type="text"
                      value={c.title || ''}
                      onChange={(e) => updateContact(idx, { title: e.target.value || null })}
                      placeholder="Title"
                      className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[12px] text-white"
                    />
                    <input
                      type="tel"
                      value={c.phone || ''}
                      onChange={(e) => updateContact(idx, { phone: e.target.value || null })}
                      placeholder="Phone"
                      className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[12px] text-white"
                    />
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Role</label>
                    <select
                      value={c.role}
                      onChange={(e) => updateContact(idx, { role: e.target.value as SuggestedJobRole })}
                      className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[12px] text-white"
                    >
                      {JOB_ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    {c.match_status === 'possible_match' && (
                      <select
                        value={c.decision || 'create_new'}
                        onChange={(e) => updateContact(idx, { decision: e.target.value as 'merge' | 'create_new' })}
                        className="px-2 py-1 bg-zinc-800 border border-amber-700 rounded text-[12px] text-amber-200"
                        title="Same name found in CRM with a different email — decide what to do"
                      >
                        <option value="create_new">Create new person</option>
                        <option value="merge">Use existing match</option>
                      </select>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1.5">
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

