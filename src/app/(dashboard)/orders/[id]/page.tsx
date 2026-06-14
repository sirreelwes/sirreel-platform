"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { StageBookingTermsSection } from "@/components/orders/StageBookingTermsSection";
import { LdDispositionPanel } from "@/components/orders/LdDispositionPanel";
import { QuoteFollowUpPanel } from "@/components/orders/QuoteFollowUpPanel";
import { EmailReviewModal, type EmailReviewTarget } from "@/components/email/EmailReviewModal";
import { shouldReview } from "@/lib/email/reviewGate";
import { LineItemRowActions } from "@/components/lineItems/LineItemRowActions";
import { LineItemUndoToast, type LineItemUndoToastState } from "@/components/lineItems/LineItemUndoToast";
import { DiscountsPanel, type DiscountsPanelData } from "@/components/orders/DiscountsPanel";
import { PushDatesModal } from "@/components/orders/PushDatesModal";
import { LineItemDescriptionCombobox } from "@/components/orders/LineItemDescriptionCombobox";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { describeAgreementStatus, RECOVERABLE_AGREEMENT_STATES } from "@/lib/portal/agreementStatus";
import { isHighRiskEmailDomain } from "@/lib/email/emailDomain";
import type { AgreementStatus, OrderStatus } from "@prisma/client";
import {
  isOrderEditable as isOrderEditableFn,
  isMoneyEditable as isMoneyEditableFn,
  isLineItemEditable as isLineItemEditableFn,
  lineEditLockReason as lineEditLockReasonFn,
  addableDepartments as addableDeptsForStatus,
} from "@/lib/orders/editability";

type LineItem = {
  id: string;
  sortOrder: number;
  type: string;
  description: string;
  rateType: string;
  rate: string;
  quantity: number;
  days: number | null;
  lineTotal: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  // Phase 1 lifecycle routing — set at book time.
  fulfillmentLane: 'FLEET' | 'WAREHOUSE' | 'STAGE' | null;
  pickStatus: 'PENDING_PICK' | 'PICKED' | 'STAGED' | 'LOADED' | null;
  // (Phase 1 step 4) Department drives the per-row lock check for
  // the post-BOOKED gate. Always present on rows from the GET; the
  // string union mirrors LineItemDepartment from Prisma.
  department: 'VEHICLES' | 'COMMUNICATIONS' | 'STAGES' | 'PRO_SUPPLIES' | 'EXPENDABLES' | 'GE' | 'ART';
  inventoryItem: { id: string; code: string; description: string } | null;
  assetCategory: { id: string; name: string } | null;
};

type JobContactRow = {
  role: string;
  isPrimary: boolean;
  person: { id: string; firstName: string; lastName: string; email: string };
};

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  notes: string | null;
  createdAt: string;
  company: { id: string; name: string };
  agent: { id: string; name: string };
  booking: {
    id: string;
    bookingNumber: string;
    jobName: string;
    productionName: string | null;
    _count: { paperworkRequests: number };
  } | null;
  jobContact: { id: string; firstName: string; lastName: string; email: string } | null;
  job: { id: string; jobCode: string; name: string; jobContacts: JobContactRow[] } | null;
  lineItems: LineItem[];
  invoices: {
    id: string; invoiceNumber: string; status: string; total: string;
    insuranceClaims?: {
      id: string; claimNumber: string;
      carrierClaimNumber: string | null;
      status: string;
    }[];
  }[];
  quotePdfKey: string | null;
  quotePdfUrl: string | null;
  quotePdfGeneratedAt: string | null;
  // Phase 3 lifecycle — fleet-side terminal stamp. Drives the lane
  // progress panel + "Mark Fleet Ready" / undo buttons.
  fleetReadyAt: string | null;
  // Phase 5 commit 1 — booked snapshot anchor. The Generate invoice
  // button is gated on bookedTotal being non-null.
  bookedTotal: string | null;
  // Blind handoff fields. When the toggle is on, the matching
  // instructions text is what the client will see in the portal.
  blindPickup: boolean;
  blindReturn: boolean;
  blindPickupInstructions: string | null;
  blindReturnInstructions: string | null;
  // Phase 1b — set when this Order was created via the inquiry
  // add-on triage path. Drives the small "Add-on" chip next to the
  // status pill in the header.
  addedToJobAt: string | null;
  // Per-send delivery audit — one row per outbound Resend dispatch
  // anchored to this order. Webhook advances `status` as Resend's
  // events arrive (sent → delivered / delayed / bounced / complained).
  emailDeliveries: EmailDelivery[];
};

type EmailDeliveryStatus = 'SENT' | 'DELIVERED' | 'DELAYED' | 'BOUNCED' | 'COMPLAINED';

type EmailDelivery = {
  id: string;
  resendMessageId: string;
  status: EmailDeliveryStatus;
  statusDetail: string | null;
  statusAt: string;
  toAddress: string;
  subject: string;
  label: string | null;
  sentAt: string;
};

// Phase 5 commit 1 — separately-fetched invoice list. Richer than the
// embedded `Order.invoices` since the dedicated /invoices endpoint
// also returns blob refs + due/sent/paid timestamps.
type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  type: 'RENTAL' | 'LD';
  status: 'DRAFT' | 'SENT' | 'PAID' | 'PARTIAL' | 'VOID';
  subtotal: string;
  taxAmount: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  dueDate: string | null;
  sentAt: string | null;
  paidAt: string | null;
  pdfUrl: string | null;
  pdfGeneratedAt: string | null;
  createdAt: string;
};

// Phase 5 commit 3 — payments per invoice.
type PaymentRow = {
  id: string;
  amount: string;
  method: 'CHECK' | 'WIRE' | 'ACH' | 'CREDIT_CARD' | 'CARDPOINTE' | 'CASH' | 'OTHER';
  reference: string | null;
  receivedAt: string;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  recordedBy: { id: string; name: string };
  voidedBy: { id: string; name: string } | null;
};

const PAYMENT_METHODS = [
  'CHECK',
  'WIRE',
  'ACH',
  'CREDIT_CARD',
  'CARDPOINTE',
  'CASH',
  'OTHER',
] as const;

interface RecipientChoice {
  primary: { id: string; name: string; email: string; role: string | null } | null;
  others: { id: string; name: string; email: string; role: string | null }[];
}

/**
 * Determine the quote-recipient priority for an Order:
 *   1. PRODUCER on the Job (CRH brief — most common quote recipient)
 *   2. The Order's explicit jobContact override (if any)
 *   3. PM on the Job
 *   4. Any contact marked primary
 *   5. First listed jobContact
 * Returns { primary, others }. `primary` is null only when no contacts exist
 * at all → the page disables the send buttons in that case.
 */
function computeRecipients(order: Order): RecipientChoice {
  const all: { id: string; name: string; email: string; role: string | null }[] = [];
  const seen = new Set<string>();
  const push = (id: string, name: string, email: string, role: string | null) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    all.push({ id, name, email, role });
  };
  for (const jc of order.job?.jobContacts || []) {
    push(jc.person.id, `${jc.person.firstName} ${jc.person.lastName}`, jc.person.email, jc.role);
  }
  if (order.jobContact) {
    push(
      order.jobContact.id,
      `${order.jobContact.firstName} ${order.jobContact.lastName}`,
      order.jobContact.email,
      null,
    );
  }

  const rank = (role: string | null, isPrimary: boolean): number => {
    if (role === 'PRODUCER') return 0;
    if (isPrimary) return 1;
    if (role === 'PM') return 2;
    if (role === 'PC') return 3;
    if (role) return 4;
    return 5; // direct jobContact override with no role
  };
  const primaryMap = new Map<string, boolean>();
  for (const jc of order.job?.jobContacts || []) {
    primaryMap.set(jc.person.id, !!jc.isPrimary);
  }
  all.sort((a, b) => rank(a.role, primaryMap.get(a.id) || false) - rank(b.role, primaryMap.get(b.id) || false));

  return { primary: all[0] || null, others: all.slice(1) };
}

type AssetCat = { id: string; name: string; slug: string; dailyRate: string; weeklyRate: string | null };
type InvItem = {
  id: string;
  code: string;
  description: string;
  // Decimal columns serialize as strings; Number() at point of use.
  // weeklyRate optional — only used when the rep flips rateType=WEEKLY.
  dailyRate: string;
  weeklyRate: string | null;
  category: { id: string; name: string };
};

// Order status pill — reuses the cadence palette so the pill reads
// the same on the Jobs list, the dispatch board, and this detail page.
// QUOTE_SENT/APPROVED/LD_CHECK don't have direct cadence counterparts;
// QUOTE_SENT inherits the in-flight warn tone, APPROVED reads as
// inbound-aware booked, LD_CHECK as the warmer "almost done" tone.
// CANCELLED uses the bad-chip tone since it isn't a cadence state.
const STATUS_COLORS: Record<string, string> = {
  DRAFT:        "bg-chip-neutral-bg text-chip-neutral-fg",
  QUOTE_SENT:   "bg-chip-warn-bg text-chip-warn-fg",
  APPROVED:     "bg-cadence-booked-bg text-cadence-booked-fg",
  BOOKED:       "bg-cadence-booked-bg text-cadence-booked-fg",
  LOADED_READY: "bg-cadence-picking-today-bg text-cadence-picking-today-fg",
  ON_JOB:       "bg-cadence-on-rental-bg text-cadence-on-rental-fg",
  RETURNED:     "bg-cadence-returned-bg text-cadence-returned-fg",
  LD_CHECK:     "bg-cadence-returning-today-bg text-cadence-returning-today-fg",
  INVOICED:     "bg-cadence-invoiced-bg text-cadence-invoiced-fg",
  CLOSED:       "bg-cadence-wrapped-bg text-cadence-wrapped-fg",
  CANCELLED:    "bg-chip-bad-bg text-chip-bad-fg",
};

// "DISCOUNT" intentionally OMITTED here — new discounts now flow through
// the first-class OrderDiscount surface (DiscountsPanel below the line
// items). Legacy DISCOUNT-type rows on existing orders continue to render
// and contribute to subtotal as today; the entry path is just closed so
// there's only one way to add a new discount going forward.
const LINE_TYPES = ["VEHICLE", "EQUIPMENT", "EXPENDABLE", "LABOR", "FEE"] as const;

// Status transitions exposed as buttons on the order detail page.
// Buttons whose `endpoint` is set POST to that path (the book action
// is the first non-PUT lifecycle transition). Buttons without
// `endpoint` fall back to PUT /api/orders/[id] with `{ status: next }`.
//
// LOADED_READY, ON_JOB, LD_CHECK, INVOICED are intentionally NOT
// surfaced as manual buttons — they are derived/automatic transitions
// landing in Phase 3 (lane rollup) and Phase 4 (native invoicing).
type StatusAction = {
  label: string
  next: string
  color: string
  endpoint?: string
}

// Status-transition button colors — semantic mapping that harmonizes
// with the cadence palette: primary CTAs use the near-black lt-fg
// background (matches the Jobs "+ New quote"), advancing actions
// pick up the destination cadence tint as a saturated -bar/-fg600
// equivalent. "Back to Draft" and "Close Order" use a restrained
// muted tone since they aren't forward-progress on the engagement.
const STATUS_ACTIONS: Record<string, StatusAction[]> = {
  DRAFT: [{ label: "Send Quote", next: "QUOTE_SENT", color: "bg-lt-fg hover:bg-black" }],
  QUOTE_SENT: [
    { label: "Mark Approved", next: "APPROVED", color: "bg-lt-fg hover:bg-black" },
    { label: "Back to Draft", next: "DRAFT", color: "bg-lt-fg2 hover:bg-lt-fg" },
  ],
  APPROVED: [
    { label: "Book it", next: "BOOKED", color: "bg-lt-fg hover:bg-black", endpoint: "book" },
  ],
  // BOOKED → LOADED_READY is rollup-derived (Phase 3). No manual
  // button — operators advance the warehouse picking floor and stamp
  // fleet-ready via the lane progress panel below. The rollup fires
  // automatically when both lanes hit terminal.
  BOOKED: [],
  // LOADED_READY → ON_JOB is the "vehicles left the yard" moment.
  // TODO: when the digital fleet checkout flow ships, replace this
  // manual Mark On Job with the driver e-sign payload (photos,
  // signature, "loaded as planned" attestation) and emit the
  // CHECKOUT_SIGN_OFF cadence event from there. Today this is just
  // a quiet status flip — no cadence event.
  LOADED_READY: [{ label: "Mark On Job", next: "ON_JOB", color: "bg-cadence-on-rental-bar hover:opacity-90" }],
  ON_JOB: [{ label: "Mark Returned", next: "RETURNED", color: "bg-cadence-returned-bar hover:opacity-90" }],
  RETURNED: [{ label: "Close Order", next: "CLOSED", color: "bg-lt-fg2 hover:bg-lt-fg" }],
};

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const orderId = params.id as string;
  // ?send=1 — set by new-quote's "Send quote" finishing-move CTA. The
  // detail page loads, hydrates the order, then auto-opens the review
  // gate against the TSX welcome+quote template. One continuous motion
  // from new-quote → preview → send.
  const autoOpenSend = searchParams?.get('send') === '1';

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [assetCats, setAssetCats] = useState<AssetCat[]>([]);
  // First-class order discounts (OrderDiscount model). Fetched from
  // /api/orders/[id]/discounts which returns the rows plus the shared
  // util's breakdown so we render persisted totals + per-dept summary
  // from one source.
  const [discountsData, setDiscountsData] = useState<DiscountsPanelData | null>(null);
  // Last description value that the inventory / asset-category pickers
  // auto-filled. Tracked in a ref (no re-render) so the pickers can
  // tell "rep didn't touch the field" (current value === last auto-fill)
  // from "rep typed a real description" (current value diverged) and
  // ONLY overwrite in the former case. Without this guard, picking a
  // catalog item silently nuked the rep's typed description.
  const lastAutoFilledDescRef = useRef<string>("");

  const [showAddForm, setShowAddForm] = useState(false);
  const [liType, setLiType] = useState<string>("EQUIPMENT");
  const [liDesc, setLiDesc] = useState("");
  const [liAssetCatId, setLiAssetCatId] = useState("");
  const [liInvItemId, setLiInvItemId] = useState("");
  const [liStartDate, setLiStartDate] = useState("");
  const [liEndDate, setLiEndDate] = useState("");
  // Custom-dates toggle on the Add form. OFF by default — new rows
  // inherit the order's pickup/return + billable days from the parent
  // Order (the API does the fallback). ON reveals Start/End inputs so
  // a rep can override on a per-line basis (e.g. an expendable with a
  // different return).
  const [liCustomDates, setLiCustomDates] = useState(false);
  // Optional days override. Empty string = "auto" (compute from
  // pickup/return). A typed value wins and persists; the row's days
  // column shows the user value, not the computed one.
  const [liDays, setLiDays] = useState("");
  const [liRateType, setLiRateType] = useState("DAILY");
  const [liRate, setLiRate] = useState("");
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editDays, setEditDays] = useState("");
  const [liQty, setLiQty] = useState("1");
  const [adding, setAdding] = useState(false);

  // Blind handoff capture — toggles + their instruction text. Local
  // state seeded from the loaded order; dirty until Save is pressed.
  const [blindPickup, setBlindPickup] = useState(false);
  const [blindReturn, setBlindReturn] = useState(false);
  const [blindPickupInstructions, setBlindPickupInstructions] = useState("");
  const [blindReturnInstructions, setBlindReturnInstructions] = useState("");
  const [blindSaving, setBlindSaving] = useState(false);
  const [blindDirty, setBlindDirty] = useState(false);
  const [blindMsg, setBlindMsg] = useState<string | null>(null);

  const [invSearch, setInvSearch] = useState("");
  const [invResults, setInvResults] = useState<InvItem[]>([]);
  const [showInvDropdown, setShowInvDropdown] = useState(false);
  const [regeneratingPdf, setRegeneratingPdf] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  type AgreementSummary = {
    id: string;
    status: string;
    documentType: string;
    baselineVersion: string | null;
    contractReviewId: string | null;
    documentToSignUrl: string | null;
    redlineUploadUrl: string | null;
    signedDocumentUrl: string | null;
    wordDocumentUrl: string | null;
    signedAt: string | null;
    signerName: string | null;
    signerTitle: string | null;
    signerEmail: string | null;
    signerIpAddress: string | null;
    signerUserAgent: string | null;
    acknowledgmentText: string | null;
    createdAt: string;
    updatedAt: string;
  };
  const [agreement, setAgreement] = useState<AgreementSummary | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [agreementBusy, setAgreementBusy] = useState(false);
  const [agreementMsg, setAgreementMsg] = useState<string>("");
  // Separate from agreementMsg so the prominent failure banner stays
  // visible (with explicit dismiss) instead of being lost in the small
  // info-strip text. Jose's report — "click Resend, see nothing" — was
  // because the 409 response landed in agreementMsg's quiet style.
  const [portalLinkError, setPortalLinkError] = useState<string | null>(null);
  // Standing-agreement context — when set, this order's
  // SignedAgreement was auto-pointed at the Company's negotiated PDF
  // by ensureSignedAgreementForOrder. Drives the banner above the
  // Rental Agreement section.
  type StandingAgreement = {
    companyName: string;
    approvedAt: string;
    summary: string | null;
    reviewDueDate: string | null;
    pdfUrl: string;
  };
  const [standingAgreement, setStandingAgreement] = useState<StandingAgreement | null>(null);

  type CadenceSummary = {
    order: { cadenceState: string; cadenceManualOverride: boolean; cadencePausedUntil: string | null };
    events: { id: string; eventType: string; scheduledFor: string; executedAt: string | null; skipped: boolean; skipReason: string | null }[];
  };
  const [cadence, setCadence] = useState<CadenceSummary | null>(null);
  const [cadenceBusy, setCadenceBusy] = useState(false);

  type PortalAccessRow = {
    id: string;
    contact: { id: string; firstName: string; lastName: string; email: string } | null;
    magicLinkExpiresAt: string;
    revokedAt: string | null;
    lastAccessedAt: string | null;
    accessCount: number;
    createdAt: string;
  };
  type DetectedContact = {
    email: string;
    displayName: string;
    person: { id: string; firstName: string; lastName: string } | null;
    mostRecentSubject: string;
    mostRecentAt: string;
  };
  const [accesses, setAccesses] = useState<PortalAccessRow[] | null>(null);
  const [detected, setDetected] = useState<DetectedContact[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirst, setInviteFirst] = useState('');
  const [inviteLast, setInviteLast] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string>('');

  // Email review modal — every agent-initiated client email (quote
  // send + Mode A follow-up) routes through one component per the
  // universal review-before-send gate. The modal hits a /preview
  // endpoint, renders the composed body in a sandboxed iframe, and
  // dispatches the real send only on the agent's confirm click.
  const [emailReviewTarget, setEmailReviewTarget] = useState<EmailReviewTarget | null>(null);
  const [sendQuoteFlash, setSendQuoteFlash] = useState<string | null>(null);
  const [lineItemUndoToast, setLineItemUndoToast] = useState<LineItemUndoToastState | null>(null);
  // One-shot guard so the ?send=1 auto-open fires once per page load,
  // not on every re-render or refresh.
  const [autoSendHandled, setAutoSendHandled] = useState(false);

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

  const fmtDate = (d: string | null) => {
    if (!d) return "--";
    const dt = new Date(d + "T00:00:00");
    if (Number.isNaN(dt.getTime())) {
      // Legacy rows can carry a malformed date string from an earlier
      // write path; render the same "--" the null case shows rather
      // than letting "Invalid Date" leak into the UI. Logged once per
      // bad value so the data team can spot the pattern.
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[orders/detail] unparseable line-item date — rendering '--':", d);
      }
      return "--";
    }
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const fetchOrder = useCallback(async () => {
    const [orderRes, discountsRes] = await Promise.all([
      fetch(`/api/orders/${orderId}`),
      fetch(`/api/orders/${orderId}/discounts`),
    ]);
    if (!orderRes.ok) { router.push("/orders"); return; }
    const data = await orderRes.json();
    setOrder(data);
    // Reset the blind-handoff local state to the server's value on
    // each fetch. Save zeros `blindDirty`; this also covers the
    // post-save refetch path.
    setBlindPickup(!!data.blindPickup);
    setBlindReturn(!!data.blindReturn);
    setBlindPickupInstructions(data.blindPickupInstructions ?? "");
    setBlindReturnInstructions(data.blindReturnInstructions ?? "");
    setBlindDirty(false);
    if (discountsRes.ok) {
      const d = await discountsRes.json();
      setDiscountsData({ discounts: d.discounts, breakdown: d.breakdown });
    } else {
      setDiscountsData(null);
    }
    setLoading(false);
  }, [orderId, router]);

  const saveBlindHandoff = useCallback(async () => {
    setBlindSaving(true);
    setBlindMsg(null);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blindPickup,
          blindReturn,
          blindPickupInstructions: blindPickup ? blindPickupInstructions : null,
          blindReturnInstructions: blindReturn ? blindReturnInstructions : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      setBlindDirty(false);
      setBlindMsg("Saved.");
      // Don't refetch the whole order — the save returns the updated
      // row but we only mutated blind* fields. Keep local state.
    } catch (e) {
      setBlindMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBlindSaving(false);
    }
  }, [orderId, blindPickup, blindReturn, blindPickupInstructions, blindReturnInstructions]);

  // Inline "Add quote recipient" form state — opened from the
  // RecipientLine warning, creates a JobContact + optional PortalAccess
  // in a single POST.
  const [addContactOpen, setAddContactOpen] = useState(false);
  // "Change dates" deliberate-action modal (push-dates flow).
  const [pushDatesOpen, setPushDatesOpen] = useState(false);
  const [addContactBusy, setAddContactBusy] = useState(false);
  const [addContactErr, setAddContactErr] = useState<string>("");
  const [addEmail, setAddEmail] = useState("");
  const [addFirst, setAddFirst] = useState("");
  const [addLast, setAddLast] = useState("");
  const [addRole, setAddRole] = useState<"PRODUCER" | "PM" | "PC" | "ACCOUNTING" | "OTHER">("PRODUCER");
  const [addGrantPortal, setAddGrantPortal] = useState(true);

  const resetAddForm = () => {
    setAddEmail("");
    setAddFirst("");
    setAddLast("");
    setAddRole("PRODUCER");
    setAddGrantPortal(true);
    setAddContactErr("");
  };

  const submitAddContact = async (opts: { andSendQuote?: boolean } = {}) => {
    if (!addEmail.trim()) {
      setAddContactErr("Email is required");
      return;
    }
    setAddContactBusy(true);
    setAddContactErr("");
    try {
      const r = await fetch(`/api/orders/${orderId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: addEmail.trim(),
          firstName: addFirst.trim() || undefined,
          lastName: addLast.trim() || undefined,
          role: addRole,
          grantPortalAccess: addGrantPortal,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAddContactErr(data.error || "Failed to add contact");
        return;
      }
      // Refresh: order data (for the recipient line) + portal access list.
      await Promise.all([fetchOrder(), fetchPortalAccess()]);
      setAddContactOpen(false);
      resetAddForm();
      if (opts.andSendQuote && order && order.status === "DRAFT") {
        await updateStatus("QUOTE_SENT");
      }
    } finally {
      setAddContactBusy(false);
    }
  };

  useEffect(() => {
    fetchOrder();
    fetch("/api/orders/lookups").then((r) => r.json()).then((data) => {
      setAssetCats(data.assetCategories || []);
    });
  }, [fetchOrder]);

  // Auto-open the email-review gate when arriving from new-quote's
  // "Send quote →" finishing-move CTA (`?send=1`). Order must be
  // hydrated (the modal needs the orderId) and the guard must be
  // unset. After firing once, scrub the query so a hard refresh
  // doesn't re-open the modal.
  useEffect(() => {
    if (!autoOpenSend) return;
    if (autoSendHandled) return;
    if (!order || !orderId) return;
    setAutoSendHandled(true);
    setEmailReviewTarget({ kind: 'quote', orderId });
    // Replace URL so future renders don't see ?send=1.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('send');
      window.history.replaceState(null, '', url.toString());
    }
  }, [autoOpenSend, autoSendHandled, order, orderId]);

  const fetchAgreement = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}/agreement`);
    if (!res.ok) return;
    const data = await res.json();
    setAgreement(data.agreement || null);
    setPortalUrl(data.portalUrl || null);
    setStandingAgreement(data.standingAgreement || null);
  }, [orderId]);

  useEffect(() => {
    fetchAgreement();
  }, [fetchAgreement]);

  const fetchCadence = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}/cadence`);
    if (!res.ok) return;
    const data = await res.json();
    setCadence(data);
  }, [orderId]);

  useEffect(() => {
    fetchCadence();
  }, [fetchCadence]);

  // Phase 5 commit 1 — invoices block. Fetched separately so the order
  // detail GET doesn't have to know about invoice listing semantics.
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [invoiceErr, setInvoiceErr] = useState<string | null>(null);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const fetchInvoices = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}/invoices`);
    if (!res.ok) {
      setInvoices([]);
      return;
    }
    const data = await res.json();
    setInvoices(data.invoices || []);
  }, [orderId]);
  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);
  const generateRentalInvoice = async () => {
    if (generatingInvoice) return;
    setGeneratingInvoice(true);
    setInvoiceErr(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setInvoiceErr(data.error || `HTTP ${res.status}`);
        return;
      }
      await fetchInvoices();
    } finally {
      setGeneratingInvoice(false);
    }
  };
  // Phase 5 commit 2 — sends the invoice via Resend with PDF attached
  // and the portal magic link in the body. Also advances Order
  // RETURNED → INVOICED (non-blocking). Re-fetches both the order
  // (status may change) and the invoice list (sentAt + status).
  const [sendingInvoiceId, setSendingInvoiceId] = useState<string | null>(null);
  const sendInvoice = async (invoiceId: string) => {
    if (sendingInvoiceId) return;
    setSendingInvoiceId(invoiceId);
    setInvoiceErr(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setInvoiceErr(data.error || `HTTP ${res.status}`);
        return;
      }
      await Promise.all([fetchOrder(), fetchInvoices()]);
    } finally {
      setSendingInvoiceId(null);
    }
  };

  // Phase 5 commit 3 — payments-per-invoice. Loaded lazily when an
  // invoice row is expanded so the order detail page doesn't pay the
  // round-trip up front. Keyed by invoiceId.
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [paymentsByInvoice, setPaymentsByInvoice] = useState<Record<string, PaymentRow[]>>({});
  const [paymentErr, setPaymentErr] = useState<string | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const fetchPayments = useCallback(async (invoiceId: string) => {
    const res = await fetch(`/api/invoices/${invoiceId}/payments`);
    if (!res.ok) return;
    const data = await res.json();
    setPaymentsByInvoice((prev) => ({ ...prev, [invoiceId]: data.payments || [] }));
  }, []);
  const toggleInvoiceRow = (invoiceId: string) => {
    if (expandedInvoiceId === invoiceId) {
      setExpandedInvoiceId(null);
    } else {
      setExpandedInvoiceId(invoiceId);
      if (!paymentsByInvoice[invoiceId]) fetchPayments(invoiceId);
    }
    setPaymentErr(null);
  };
  const recordPayment = async (
    invoiceId: string,
    body: { amount: number; method: string; receivedAt: string; reference: string; notes: string },
  ) => {
    if (recordingPayment) return;
    setRecordingPayment(true);
    setPaymentErr(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setPaymentErr(data.error || `HTTP ${res.status}`);
        return;
      }
      await Promise.all([fetchOrder(), fetchInvoices(), fetchPayments(invoiceId)]);
    } finally {
      setRecordingPayment(false);
    }
  };
  const voidPayment = async (paymentId: string, invoiceId: string) => {
    const reason = window.prompt('Reason for voiding this payment? (≥4 chars)');
    if (!reason || reason.trim().length < 4) return;
    setPaymentErr(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setPaymentErr(data.error || `HTTP ${res.status}`);
        return;
      }
      await Promise.all([fetchOrder(), fetchInvoices(), fetchPayments(invoiceId)]);
    } catch (e) {
      setPaymentErr(e instanceof Error ? e.message : 'void failed');
    }
  };

  const fetchPortalAccess = useCallback(async () => {
    const [listRes, detRes] = await Promise.all([
      fetch(`/api/orders/${orderId}/portal-access`),
      fetch(`/api/orders/${orderId}/portal-access/detected`),
    ]);
    if (listRes.ok) {
      const data = await listRes.json();
      setAccesses(data.accesses || []);
    } else {
      setAccesses([]);
    }
    if (detRes.ok) {
      const data = await detRes.json();
      setDetected(data.detected || []);
    }
  }, [orderId]);

  useEffect(() => {
    fetchPortalAccess();
  }, [fetchPortalAccess]);

  const directInvite = async (e?: { email: string; firstName?: string; lastName?: string }) => {
    const email = e?.email ?? inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    setInviteMsg('');
    try {
      const r = await fetch(`/api/orders/${orderId}/portal-access/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          firstName: (e?.firstName ?? inviteFirst.trim()) || undefined,
          lastName: (e?.lastName ?? inviteLast.trim()) || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setInviteMsg(data.error || 'Invite failed');
        return;
      }
      setInviteMsg(
        data.emailResult?.ok
          ? `Invite sent to ${email}.`
          : `Invite created but email failed: ${data.emailResult?.reason || 'unknown'} · URL: ${data.portalUrl}`,
      );
      setInviteEmail('');
      setInviteFirst('');
      setInviteLast('');
      await fetchPortalAccess();
    } finally {
      setInviteBusy(false);
    }
  };

  const revokeAccess = async (portalAccessId: string) => {
    if (!confirm('Revoke this portal access?')) return;
    await fetch(`/api/orders/${orderId}/portal-access`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portalAccessId }),
    });
    await fetchPortalAccess();
  };

  const regenerateAccess = async (contactId: string) => {
    const r = await fetch(`/api/orders/${orderId}/portal-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, regenerate: true }),
    });
    const data = await r.json();
    await fetchPortalAccess();
    if (data?.portalUrl) {
      navigator.clipboard?.writeText(data.portalUrl).catch(() => {});
      setInviteMsg(`Regenerated. Link copied to clipboard.`);
    }
  };

  const toggleCadenceOverride = async (next: boolean) => {
    setCadenceBusy(true);
    try {
      await fetch(`/api/orders/${orderId}/cadence`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manualOverride: next }),
      });
      await fetchCadence();
    } finally {
      setCadenceBusy(false);
    }
  };

  const clearCadencePause = async () => {
    setCadenceBusy(true);
    try {
      await fetch(`/api/orders/${orderId}/cadence`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadencePausedUntil: null }),
      });
      await fetchCadence();
    } finally {
      setCadenceBusy(false);
    }
  };

  const overrideAgreementStatus = async (next: string) => {
    if (!confirm(`Override agreement status to ${next.replace(/_/g, " ")}?`)) return;
    setAgreementBusy(true);
    setAgreementMsg("");
    try {
      const r = await fetch(`/api/orders/${orderId}/agreement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAgreementMsg(data.error || "Override failed");
        return;
      }
      await fetchAgreement();
      setAgreementMsg(`Status set to ${data.status.replace(/_/g, " ")}.`);
    } finally {
      setAgreementBusy(false);
    }
  };

  const releaseAgreementToPortal = async () => {
    if (
      !confirm(
        'Release the rental agreement to the client portal? ' +
          'They will see the in-portal Sign link on their next visit.',
      )
    )
      return;
    setAgreementBusy(true);
    setAgreementMsg("");
    try {
      const r = await fetch(`/api/orders/${orderId}/agreement/release`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.ok === false) {
        setAgreementMsg(data.error || 'Release failed');
        return;
      }
      await fetchAgreement();
      setAgreementMsg('Released to portal — client can now sign.');
    } finally {
      setAgreementBusy(false);
    }
  };

  const resendPortalLink = async () => {
    setAgreementBusy(true);
    setAgreementMsg("");
    setPortalLinkError(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/agreement/resend-link`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (data.portalUrl) setPortalUrl(data.portalUrl);
      if (!r.ok) {
        // Route failures to the prominent banner — agreementMsg is a
        // tiny info strip and was being missed entirely.
        const portalSuffix = data.portalUrl ? ` Portal URL: ${data.portalUrl}` : "";
        setPortalLinkError((data.error || "Resend failed") + portalSuffix);
        return;
      }
      setAgreementMsg(`Portal link emailed to ${data.recipient}.`);
    } finally {
      setAgreementBusy(false);
    }
  };

  useEffect(() => {
    if (invSearch.length < 2) { setInvResults([]); return; }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      const res = await fetch(`/api/inventory/search?q=${encodeURIComponent(invSearch)}&limit=10`);
      const data = await res.json();
      setInvResults(data.items || []);
      setShowInvDropdown(true);
    }, 250);
  }, [invSearch]);

  // No date pre-population on mount — the spec says new rows inherit
  // the order's dates + billable days by default, and the API does the
  // fallback when startDate/endDate are omitted. Pre-filling them on
  // the form caused two bugs: (a) the form unconditionally shipped
  // dates, so changing the order's range later didn't propagate to
  // already-added rows, and (b) the API's computeRentalDays applied
  // its +1 inclusive-day adjustment on a date pair that matched the
  // order's range exactly, producing the "5 days for a 3-day order"
  // miscount Jose hit. Custom dates is now an explicit opt-in toggle.

  const updateStatus = async (newStatus: string) => {
    await fetch(`/api/orders/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchOrder();
  };

  // "Book it" — APPROVED → BOOKED. POSTs to the dedicated lifecycle
  // endpoint (atomic snapshot + lane routing + audit log + cadence
  // projection). On 409 the order is no longer APPROVED (someone else
  // booked, or status got rolled back); we surface the server's error.
  const [bookErr, setBookErr] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const bookIt = async () => {
    if (booking) return;
    setBooking(true);
    setBookErr(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setBookErr(data.error || `HTTP ${r.status}`);
        return;
      }
      await fetchOrder();
    } finally {
      setBooking(false);
    }
  };

  // Phase 3 — fleet-side lifecycle trigger. Stamp (or undo) fleet-ready.
  // Either call may auto-advance the order to LOADED_READY via the
  // server-side rollup. After a successful response we re-fetch to
  // reflect both fleetReadyAt + the new status.
  const [fleetErr, setFleetErr] = useState<string | null>(null);
  const [fleetBusy, setFleetBusy] = useState<'stamp' | 'undo' | null>(null);
  const stampFleetReady = async () => {
    if (fleetBusy) return;
    setFleetBusy('stamp');
    setFleetErr(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/fleet-ready`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setFleetErr(data.reason || data.error || `HTTP ${r.status}`);
        return;
      }
      await fetchOrder();
    } finally {
      setFleetBusy(null);
    }
  };
  const undoFleetReady = async () => {
    if (fleetBusy) return;
    if (!window.confirm('Undo fleet ready? If the LOADED_AND_READY email already sent to the client, it cannot be unsent.')) return;
    setFleetBusy('undo');
    setFleetErr(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/fleet-ready?undo=1`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setFleetErr(data.reason || data.error || `HTTP ${r.status}`);
        return;
      }
      await fetchOrder();
    } finally {
      setFleetBusy(null);
    }
  };

  // Opens the EmailReviewModal for quote send. The modal handles
  // preview + dispatch + token mint; this component just refreshes
  // the order on success so the post-send QUOTE_SENT status reflects.
  const openSendQuoteReview = () => {
    if (!orderId) return;
    // shouldReview check is documentation of the gate — today it
    // always returns true. To later auto-send a quote without the
    // preview step, flip the entry in src/lib/email/reviewGate.ts
    // and wire a direct-fetch path here.
    if (!shouldReview('quote')) {
      // Auto-send path not implemented; fall back to the modal so
      // the gate is never accidentally bypassed by a stale flag.
    }
    setEmailReviewTarget({ kind: 'quote', orderId });
  };

  const cancelOrder = async () => {
    if (!confirm("Cancel this order? This cannot be undone.")) return;
    await updateStatus("CANCELLED");
  };

  const deleteOrder = async () => {
    if (!confirm("Delete this draft order?")) return;
    await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
    router.push("/orders");
  };

  // Re-render the Quote PDF off the current Order state (line items,
  // discount, totals). The endpoint replaces the prior blob and updates
  // quotePdfKey/quotePdfUrl/quotePdfGeneratedAt on the Order.
  const regeneratePdf = async () => {
    setRegeneratingPdf(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/quote-pdf`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to regenerate PDF");
        return;
      }
      await fetchOrder();
    } finally {
      setRegeneratingPdf(false);
    }
  };

  // Description guard: only auto-fill when the field is empty OR still
  // holds the last value WE auto-filled. If the rep typed something the
  // picker isn't allowed to clobber it — preserves typed input across
  // catalog picks while still letting two successive picks update each
  // other naturally.
  const maybeAutoFillDesc = (next: string) => {
    if (liDesc === "" || liDesc === lastAutoFilledDescRef.current) {
      setLiDesc(next);
      lastAutoFilledDescRef.current = next;
    }
  };

  const selectAssetCategory = (cat: AssetCat) => {
    setLiAssetCatId(cat.id);
    maybeAutoFillDesc(cat.name);
    setLiRate(String(Number(cat.dailyRate)));
    setLiRateType("DAILY");
  };

  const selectInventoryItem = (item: InvItem) => {
    setLiInvItemId(item.id);
    maybeAutoFillDesc(item.description || item.code);
    // Auto-fill the rate field from the catalog — matches what
    // selectAssetCategory has always done, and what reps were silently
    // expecting on the inventory path (Jose's repro: typing a custom
    // rate after picking an item, because nothing pre-populated). Rate
    // is unconditionally set: the rep can still override the value in
    // the input. weeklyRate kicks in only when the rep flips rateType
    // to WEEKLY; default rateType stays DAILY.
    const daily = Number(item.dailyRate);
    if (Number.isFinite(daily) && daily > 0) {
      setLiRate(String(daily));
      setLiRateType("DAILY");
    }
    setInvSearch(item.code);
    setShowInvDropdown(false);
  };

  const resetForm = () => {
    setLiType("EQUIPMENT"); setLiDesc(""); setLiAssetCatId(""); setLiInvItemId("");
    // Custom dates default OFF — the API inherits from the parent
    // Order. Per-line override is opt-in via the toggle on the form.
    setLiStartDate("");
    setLiEndDate("");
    setLiCustomDates(false);
    setLiDays("");
    setLiRateType("DAILY"); setLiRate(""); setLiQty("1");
    setInvSearch(""); setInvResults([]);
    lastAutoFilledDescRef.current = "";
  };

  const addLineItem = async () => {
    if (!liDesc || !liRate) return;
    setAdding(true);
    // Body shape: only include startDate/endDate when the rep explicitly
    // opted into Custom dates. Otherwise the API inherits from the parent
    // Order's range — identical billing window to original quote items.
    // Same for billableDays: omit when blank ("auto"), include when typed.
    const body: Record<string, unknown> = {
      type: liType,
      description: liDesc,
      inventoryItemId: liInvItemId || null,
      assetCategoryId: liAssetCatId || null,
      rateType: liRateType,
      rate: parseFloat(liRate),
      quantity: parseInt(liQty) || 1,
    };
    if (liCustomDates) {
      body.startDate = liStartDate || null;
      body.endDate = liEndDate || null;
    }
    const typedDays = liDays.trim();
    if (typedDays !== "") {
      const n = Number(typedDays);
      if (Number.isFinite(n) && n > 0) body.billableDays = n;
    }
    const res = await fetch(`/api/orders/${orderId}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // (Phase 1 step 4) Surface the backend's per-dept rejection
    // clearly. The 409 carries a `reason` string from
    // lineEditLockReason() — the rep needs to see WHY, not a silent
    // failure (same lesson as Jose's portal button).
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data?.reason || data?.error || `Failed to add line (HTTP ${res.status})`;
      alert(msg);
      setAdding(false);
      return;
    }
    resetForm(); setAdding(false); fetchOrder();
  };

  const startEditLine = (li: LineItem) => {
    setEditingLineId(li.id);
    setEditRate(String(Number(li.rate)));
    setEditQty(String(li.quantity));
    setEditDays(li.days !== null && li.days !== undefined ? String(li.days) : "");
  };

  const saveEditLine = async (lineId: string) => {
    const body: Record<string, unknown> = {
      rate: parseFloat(editRate) || 0,
      quantity: parseInt(editQty) || 1,
    };
    if (editDays !== "") body.days = parseFloat(editDays);
    await fetch(`/api/orders/${order?.id}/line-items/${lineId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setEditingLineId(null);
    fetchOrder();
  };

  // Frictionless remove + undo toast. The line we're about to delete
  // is snapshotted BEFORE the API call so the undo POST can recreate
  // it with the same shape (description, rate, dates, etc.).
  const deleteLineItem = async (li: LineItem) => {
    const snapshot = li; // capture before fetchOrder() invalidates references
    await fetch(`/api/orders/${orderId}/line-items/${li.id}`, { method: "DELETE" });
    await fetchOrder();
    setLineItemUndoToast({
      label: snapshot.description || "(line item)",
      onUndo: async () => {
        // Re-POST with the captured shape. The endpoint at
        // /api/orders/[id]/line-items accepts type/description/rate
        // as required + a bunch of optionals; mirror the snapshot so
        // the recreated row matches the original as closely as the
        // API allows. Server assigns a new id + sortOrder.
        await fetch(`/api/orders/${orderId}/line-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: snapshot.type,
            description: snapshot.description,
            inventoryItemId: snapshot.inventoryItem?.id ?? undefined,
            assetCategoryId: snapshot.assetCategory?.id ?? undefined,
            startDate: snapshot.startDate,
            endDate: snapshot.endDate,
            rateType: snapshot.rateType,
            rate: Number(snapshot.rate),
            quantity: snapshot.quantity,
            billableDays: snapshot.days ?? undefined,
            notes: snapshot.notes ?? undefined,
          }),
        });
        await fetchOrder();
      },
      onDismiss: () => setLineItemUndoToast(null),
    });
  };

  if (loading || !order) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <p className="text-lt-fg3">Loading order...</p>
      </div>
    );
  }

  const actions = STATUS_ACTIONS[order.status] || [];
  // (Phase 1 step 4) Gate widened to the full editable lifecycle.
  // Hold-tracked departments (VEHICLES, STAGES) are locked PER-ROW
  // post-BOOKED via lineEditLockReason from the same helper — UI
  // and API never drift. Discounts read isMoneyEditable below.
  const isEditable = isOrderEditableFn(order.status as OrderStatus);
  const isMoneyEditableForOrder = isMoneyEditableFn(order.status as OrderStatus);
  // POST_BOOKED_STATUSES — drives the per-dept add-form filter +
  // the locked-row indicator on the existing VEHICLES/STAGES rows.
  const isPostBookedRestricted = ["BOOKED", "LOADED_READY", "ON_JOB", "RETURNED", "LD_CHECK"].includes(order.status);
  const addableDeptsForOrder = addableDeptsForStatus(order.status as OrderStatus);

  // Portal-link preconditions — derived from the order payload so the
  // "Resend portal link" button is disabled BEFORE the rep clicks
  // (rather than 4xx'ing after). Mirror of the endpoint's gates:
  //   1. !order.bookingId → 409 "Order has no booking …"
  //   2. paperworkRequests.count === 0 → 409 "No paperwork request …"
  //   3. !recipient email → 400 "No valid recipient …"
  // Tooltip surfaces the first missing requirement.
  const portalLinkPrecondition: { ok: true } | { ok: false; reason: string } = (() => {
    if (!order.booking) return { ok: false, reason: 'Needs a booking before a portal link can be sent.' };
    if ((order.booking._count?.paperworkRequests ?? 0) === 0) {
      return { ok: false, reason: 'No paperwork request yet — send the rental agreement first to mint a portal token.' };
    }
    const recipient = order.jobContact?.email
      || order.job?.jobContacts?.[0]?.person?.email
      || null;
    if (!recipient) return { ok: false, reason: 'No contact email on file — add a job contact with a valid email.' };
    return { ok: true };
  })();
  const recipients = computeRecipients(order);
  const noRecipient = !recipients.primary;

  return (
    // Light-motif page bg — overrides the dashboard shell's default
    // until the rollout converts every page. Matches the Jobs page's
    // wrapper so the two surfaces feel like one engagement.
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1200px] mx-auto">
        <button onClick={() => router.push("/orders")} className="text-sm text-lt-fg2 hover:text-lt-fg mb-4 inline-block">
          &larr; Back to Orders
        </button>

      {/* Order Header */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h1 className="text-2xl font-semibold text-lt-fg3 font-mono tracking-tight">{order.orderNumber}</h1>
              <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[order.status]}`}>
                {order.status.replace("_", " ")}
              </span>
              {order.addedToJobAt && (
                <span
                  title="Added later via inquiry triage"
                  className="px-2.5 py-0.5 rounded text-xs font-medium bg-chip-neutral-bg text-chip-neutral-fg"
                >
                  Add-on
                </span>
              )}
              {/* Insurance-claim chip — one per claim attached to any
                  invoice on this order. Links to /claims/[id] so the
                  rep can jump from the order to the live claim. When
                  the carrier's own claim number is known, render
                  both so a rep can quote either side's reference
                  without opening the claim. */}
              {order.invoices.flatMap((inv) => inv.insuranceClaims ?? []).map((claim) => (
                <Link
                  key={claim.id}
                  href={`/claims/${claim.id}`}
                  title={`Claim ${claim.claimNumber}${claim.carrierClaimNumber ? ` · carrier # ${claim.carrierClaimNumber}` : ''} · ${claim.status}`}
                  className="px-2.5 py-0.5 rounded text-xs font-medium bg-chip-warn-bg text-chip-warn-fg hover:underline underline-offset-2"
                >
                  Claim {claim.claimNumber}
                  {claim.carrierClaimNumber && (
                    <span className="font-mono text-chip-warn-fg/70"> · {claim.carrierClaimNumber}</span>
                  )}
                </Link>
              ))}
            </div>
            <p className="text-lt-fg2">{order.description || "No description"}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-2">
              {actions.map((action) => {
                const isSendQuote = action.next === "QUOTE_SENT";
                const isBook = action.endpoint === "book";
                const disabled =
                  (isSendQuote && (noRecipient || !order.quotePdfUrl)) ||
                  (isBook && booking);
                const title = isSendQuote
                  ? noRecipient
                    ? "Add a contact to the job before sending the quote."
                    : !order.quotePdfUrl
                      ? "Generate the quote PDF first."
                      : undefined
                  : undefined;
                const onClick = isSendQuote
                  ? openSendQuoteReview
                  : isBook
                    ? bookIt
                    : () => updateStatus(action.next);
                return (
                  <button
                    key={action.next}
                    onClick={onClick}
                    disabled={disabled}
                    title={title}
                    className={`px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors ${action.color} disabled:bg-lt-inner disabled:text-lt-fg3 disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {isBook && booking ? "Booking…" : action.label}
                  </button>
                );
              })}
              {order.status !== "CANCELLED" && order.status !== "CLOSED" && (
                <button onClick={cancelOrder} className="px-3 py-2 text-chip-bad-fg hover:opacity-70 text-sm">Cancel</button>
              )}
              {order.status === "DRAFT" && (
                <button onClick={deleteOrder} className="px-3 py-2 text-lt-fg3 hover:text-chip-bad-fg text-sm">Delete</button>
              )}
            </div>
            {order.status === "DRAFT" && (
              <RecipientLine recipients={recipients} onAdd={() => setAddContactOpen(true)} />
            )}
            {bookErr && (
              <div className="text-xs text-chip-bad-fg mt-1.5 max-w-xs text-right">
                Book it failed: {bookErr}
              </div>
            )}
          </div>
        </div>

        {addContactOpen && (
          <div className="mt-4 border-t border-lt-hairline pt-4">
            <AddContactForm
              email={addEmail}
              first={addFirst}
              last={addLast}
              role={addRole}
              grantPortal={addGrantPortal}
              busy={addContactBusy}
              err={addContactErr}
              hasQuotePdf={!!order.quotePdfUrl}
              onChange={{
                email: setAddEmail,
                first: setAddFirst,
                last: setAddLast,
                role: setAddRole,
                grantPortal: setAddGrantPortal,
              }}
              onSubmit={(andSendQuote) => submitAddContact({ andSendQuote })}
              onCancel={() => {
                setAddContactOpen(false);
                resetAddForm();
              }}
            />
          </div>
        )}
        <div className="grid grid-cols-4 gap-6 text-sm">
          <div><span className="text-lt-fg3">Company</span><p className="text-lt-fg mt-0.5">{order.company.name}</p></div>
          <div><span className="text-lt-fg3">Agent</span><p className="text-lt-fg mt-0.5">{order.agent.name}</p></div>
          <div>
            <span className="text-lt-fg3">Dates</span>
            <p className="text-lt-fg mt-0.5">
              {fmtDate(order.startDate)} - {fmtDate(order.endDate)}
              {order.startDate && order.endDate && (
                <button
                  type="button"
                  onClick={() => setPushDatesOpen(true)}
                  className="ml-2 text-xs text-amber-500 hover:text-amber-400"
                  title="Move the entire order range — preview cascade first"
                >
                  Change…
                </button>
              )}
            </p>
          </div>
          <div><span className="text-lt-fg3">Linked Booking</span><p className="text-lt-fg mt-0.5">
            {order.booking ? <a href={`/jobs/${order.booking.id}`} className="text-lt-fg hover:text-black">{order.booking.bookingNumber}</a> : <span className="text-lt-fg3">None</span>}
          </p></div>
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden mb-6">
        <div className="flex items-center justify-between px-6 py-4 border-b border-lt-hairline">
          <h2 className="text-lg font-semibold text-lt-fg">Line Items</h2>
          {isEditable && (
            <button onClick={() => { setShowAddForm(!showAddForm); if (!showAddForm) resetForm(); }}
              className="px-3 py-1.5 bg-lt-fg hover:bg-black text-white text-sm font-medium rounded-lg transition-colors">
              {showAddForm ? "Cancel" : "+ Add Item"}
            </button>
          )}
        </div>

        {showAddForm && isEditable && (
          <div className="px-6 py-4 bg-lt-inner/50 border-b border-lt-hairline space-y-4">
            {/* (Phase 1 step 4) Post-BOOKED add-restriction notice.
                Visible whenever the rep is adding to a BOOKED-or-later
                order so they know upfront WHY VEHICLE isn't in the
                Type dropdown. Mirrors the locked-row indicator on
                existing vehicle/stage lines. */}
            {isPostBookedRestricted && (
              <div className="bg-chip-warn-bg border border-chip-warn-fg/30 rounded-lg p-2.5 text-xs text-chip-warn-fg flex items-start gap-2">
                <span>🔒</span>
                <span>
                  <span className="font-semibold">Vehicle &amp; stage adds coming next release.</span>
                  {' '}You can add supplies, G&amp;E, expendables, communications, and art lines now.
                  Stage or vehicle items will be rejected on save with a clear error.
                </span>
              </div>
            )}
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-lt-fg3 mb-1">Type</label>
                <select value={liType} onChange={(e) => { setLiType(e.target.value); setLiDesc(""); setLiAssetCatId(""); setLiInvItemId(""); setInvSearch(""); }}
                  className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2">
                  {LINE_TYPES.filter((t) => !(isPostBookedRestricted && t === 'VEHICLE')).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-5">
                <label className="block text-xs text-lt-fg3 mb-1">
                  {liType === "VEHICLE" ? "Vehicle" : liType === "EQUIPMENT" || liType === "EXPENDABLE" ? "Search Inventory" : "Description"}
                </label>
                {liType === "VEHICLE" ? (
                  <select value={liAssetCatId} onChange={(e) => { const cat = assetCats.find((c) => c.id === e.target.value); if (cat) selectAssetCategory(cat); }}
                    className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2">
                    <option value="">Select vehicle...</option>
                    {assetCats.map((c) => <option key={c.id} value={c.id}>{c.name} ({fmt(c.dailyRate)}/day)</option>)}
                  </select>
                ) : liType === "EQUIPMENT" || liType === "EXPENDABLE" ? (
                  <LineItemDescriptionCombobox
                    value={invSearch}
                    onChange={(next) => setInvSearch(next)}
                    onPickCatalog={(hit) => {
                      if (hit.type === 'ASSET_CATEGORY') {
                        // Modal type is EQUIPMENT/EXPENDABLE; if rep
                        // picks a vehicle category, flip the type and
                        // let selectAssetCategory handle binding.
                        const cat = assetCats.find((c) => c.id === hit.id)
                        if (cat) {
                          setLiType('VEHICLE')
                          setLiAssetCatId(cat.id)
                          selectAssetCategory(cat)
                          setInvSearch(cat.name)
                        }
                        return
                      }
                      if (hit.type === 'PACKAGE') {
                        // Package picks bypass the modal entirely —
                        // expand to header + members via the batch
                        // endpoint, refresh the order, close the form.
                        ;(async () => {
                          try {
                            const res = await fetch(`/api/orders/${orderId}/line-items/from-package`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ packageId: hit.id }),
                            })
                            if (res.ok) {
                              await fetchOrder()
                              setShowAddForm(false)
                              resetForm()
                            }
                          } catch (err) {
                            console.warn('[orders] package expand failed:', err)
                          }
                        })()
                        return
                      }
                      // Map combobox hit back into the modal's
                      // existing InvItem shape that selectInventoryItem
                      // expects.
                      selectInventoryItem({
                        id: hit.id,
                        code: hit.name,
                        description: hit.name,
                        dailyRate: String(hit.dailyRate),
                        weeklyRate: hit.weeklyRate ? String(hit.weeklyRate) : null,
                        category: { id: '', name: hit.department.replace(/_/g, ' ') },
                      })
                      setInvSearch(hit.name)
                    }}
                    catalogBinding={
                      liInvItemId
                        ? { id: liInvItemId, type: 'INVENTORY', name: invSearch }
                        : null
                    }
                    onClearCatalog={() => {
                      setLiInvItemId('')
                    }}
                    placeholder="Type to search inventory..."
                    hideCustomChip
                  />
                ) : (
                  <input type="text" value={liDesc} onChange={(e) => setLiDesc(e.target.value)} placeholder="e.g. Day Player Grip, Delivery Fee..."
                    className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2" />
                )}
              </div>
              <div className="col-span-5">
                <label className="block text-xs text-lt-fg3 mb-1">Description (on invoice)</label>
                <input type="text" value={liDesc} onChange={(e) => setLiDesc(e.target.value)}
                  className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2" />
              </div>
            </div>
            {/* Custom-dates toggle. Default OFF: new rows inherit the
                order's pickup/return + billable days (matches original
                quote items). When ON, the Start/End inputs reveal so a
                rep can override per-line. Days is always editable —
                blank = "auto" (compute from window). */}
            <div className="flex items-center justify-between text-xs mb-2">
              <label className="inline-flex items-center gap-2 text-lt-fg2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={liCustomDates}
                  onChange={(e) => setLiCustomDates(e.target.checked)}
                  className="rounded border-lt-hairline"
                />
                Custom dates
              </label>
              {!liCustomDates && order?.startDate && order?.endDate && (
                <span className="text-lt-fg3">
                  Inherits order range: {fmtDate(order.startDate)} – {fmtDate(order.endDate)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-12 gap-3">
              {liCustomDates && (
                <>
                  <div className="col-span-2">
                    <label className="block text-xs text-lt-fg3 mb-1">Start</label>
                    <input type="date" value={liStartDate} onChange={(e) => setLiStartDate(e.target.value)}
                      className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-lt-fg3 mb-1">End</label>
                    <input type="date" value={liEndDate} onChange={(e) => setLiEndDate(e.target.value)}
                      className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2" />
                  </div>
                </>
              )}
              <div className="col-span-2">
                <label className="block text-xs text-lt-fg3 mb-1">Rate Type</label>
                <select value={liRateType} onChange={(e) => setLiRateType(e.target.value)}
                  className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2">
                  <option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="FLAT">Flat</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-lt-fg3 mb-1">Rate</label>
                <CurrencyInput
                  value={Number(liRate) || 0}
                  onChange={(next) => setLiRate(next === 0 ? '' : String(next))}
                  min={0}
                  inputClassName="px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2"
                  ariaLabel="Rate"
                />
              </div>
              <div className="col-span-1">
                <label className="block text-xs text-lt-fg3 mb-1">Days</label>
                <input
                  type="number" step="0.5" min="0"
                  value={liDays}
                  onChange={(e) => setLiDays(e.target.value)}
                  placeholder="auto"
                  className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg placeholder:text-lt-fg3 placeholder:italic focus:outline-none focus:border-lt-fg2"
                />
              </div>
              <div className="col-span-1">
                <label className="block text-xs text-lt-fg3 mb-1">Qty</label>
                <input type="number" min="1" value={liQty} onChange={(e) => setLiQty(e.target.value)}
                  className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2" />
              </div>
              {/* Dynamic col-span — fewer columns are visible when
                  Custom dates is OFF, so the Add/Cancel block stretches
                  to fill the row width consistently. */}
              <div className={`${liCustomDates ? 'col-span-3' : 'col-span-7'} flex items-end gap-2`}>
                <button onClick={addLineItem} disabled={!liDesc || !liRate || adding}
                  className="px-4 py-1.5 bg-cadence-on-rental-bar hover:opacity-90 disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-medium rounded transition-colors">
                  {adding ? "Adding..." : "Add"}
                </button>
                <button onClick={() => setShowAddForm(false)} className="px-3 py-1.5 text-lt-fg2 hover:text-lt-fg text-sm transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-lt-hairline text-lt-fg3 text-left text-xs uppercase tracking-wide">
              <th className="px-6 py-2.5 font-medium w-[80px]">Type</th>
              <th className="px-4 py-2.5 font-medium">Description</th>
              <th className="px-4 py-2.5 font-medium">Dates</th>
              <th className="px-4 py-2.5 font-medium">Rate</th>
              <th className="px-4 py-2.5 font-medium text-center">Qty</th>
              <th className="px-4 py-2.5 font-medium text-center">Days</th>
              <th className="px-4 py-2.5 font-medium text-right">Total</th>
              {/* Actions column always renders so the row-actions
                  affordance is consistent across editable / locked
                  states. When the order is locked the kebab self-
                  renders as a lock glyph with a tooltip — agents see
                  WHY editing is unavailable instead of a missing
                  column. */}
              <th className="px-4 py-2.5 font-medium w-[80px]"></th>
            </tr>
          </thead>
          <tbody>
            {order.lineItems.length === 0 ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-lt-fg3">
                No line items yet. Click \"+ Add Item\" to start building this order.
              </td></tr>
            ) : (
              order.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-lt-hairline/50 hover:bg-lt-inner/30">
                  <td className="px-6 py-3">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      li.type === "VEHICLE" ? "bg-chip-neutral-bg text-chip-neutral-fg" :
                      li.type === "DISCOUNT" ? "bg-chip-neutral-bg text-chip-neutral-fg" :
                      li.type === "FEE" ? "bg-chip-neutral-bg text-chip-neutral-fg" :
                      "bg-lt-inner text-lt-fg2"
                    }`}>{li.type}</span>
                  </td>
                  <td className="px-4 py-3 text-lt-fg">{li.description}</td>
                  <td className="px-4 py-3 text-lt-fg2 whitespace-nowrap text-xs">
                    {li.startDate ? `${fmtDate(li.startDate)} - ${fmtDate(li.endDate)}` : "--"}
                  </td>
                  {editingLineId === li.id ? (
                    <>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <CurrencyInput
                            value={Number(editRate) || 0}
                            onChange={(next) => setEditRate(next === 0 ? '' : String(next))}
                            min={0}
                            className="w-24"
                            inputClassName="px-2 py-1 bg-lt-card border border-lt-hairline rounded text-xs text-lt-fg text-right font-mono"
                            ariaLabel="Edit rate"
                          />
                          <span className="text-lt-fg3 text-xs">/{li.rateType === "FLAT" ? "flat" : li.rateType === "WEEKLY" ? "wk" : "day"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="number" value={editQty} onChange={(e) => setEditQty(e.target.value)}
                          className="w-14 px-2 py-1 bg-lt-card border border-lt-hairline rounded text-xs text-lt-fg text-center" />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="number" step="0.5" value={editDays} onChange={(e) => setEditDays(e.target.value)}
                          placeholder="auto"
                          className="w-14 px-2 py-1 bg-lt-card border border-lt-hairline rounded text-xs text-lt-fg text-center" />
                      </td>
                      <td className="px-4 py-3 text-right text-lt-fg font-mono">{fmt(li.lineTotal)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <button onClick={() => saveEditLine(li.id)} className="text-chip-good-fg hover:opacity-70 text-xs mr-2">Save</button>
                        <button onClick={() => setEditingLineId(null)} className="text-lt-fg3 hover:text-lt-fg2 text-xs">X</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-lt-fg2 whitespace-nowrap">
                        {fmt(li.rate)}<span className="text-lt-fg3 text-xs">/{li.rateType === "FLAT" ? "flat" : li.rateType === "WEEKLY" ? "wk" : "day"}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-lt-fg2">{li.quantity}</td>
                      <td className="px-4 py-3 text-center text-lt-fg2">{li.days ?? "--"}</td>
                      <td className="px-4 py-3 text-right text-lt-fg font-mono">{fmt(li.lineTotal)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        {(() => {
                          // (Phase 1 step 4) Per-row lock check — VEHICLES /
                          // STAGES on post-BOOKED orders stay locked until
                          // Phase 2's holds-sync lands. Reason text comes
                          // from the same helper as the backend gate so UI
                          // and API can't drift on the message either.
                          const lineEditable = isLineItemEditableFn(
                            order.status as OrderStatus,
                            li.department,
                          );
                          const lockReason = lineEditLockReasonFn(
                            order.status as OrderStatus,
                            li.department,
                          ) ?? 'Order is past QUOTE_SENT — line items can\u2019t be edited directly. Re-quote or void to make changes.';
                          return (
                            <>
                              {lineEditable ? (
                                <button
                                  onClick={() => startEditLine(li)}
                                  className="text-lt-fg3 hover:text-lt-fg text-xs mr-2"
                                >
                                  Edit
                                </button>
                              ) : (
                                isPostBookedRestricted && (li.department === 'VEHICLES' || li.department === 'STAGES') && (
                                  <span
                                    className="text-[10px] text-lt-fg3 mr-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-lt-hairline"
                                    title={lockReason}
                                  >
                                    🔒 {li.department === 'VEHICLES' ? 'Vehicle' : 'Stage'} — edits coming next release
                                  </span>
                                )
                              )}
                              <span className="inline-block align-middle">
                                <LineItemRowActions
                                  onRemove={() => { void deleteLineItem(li); }}
                                  editability={{
                                    canEdit: lineEditable,
                                    lockedReason: lockReason,
                                  }}
                                />
                              </span>
                            </>
                          );
                        })()}
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Discounts panel — first-class. Renders null when there's no
            line content AND no existing discounts ("no discounts =
            layout unchanged" per the spec). isEditable mirrors the
            line-item editability rule. */}
        <DiscountsPanel
          orderId={orderId}
          // Discounts are money-only — no hold/pick consequence. Use the
          // wider money-editable gate so reps can still adjust totals
          // post-BOOKED. Step 2's bookedTotal-tracks-live ensures the
          // change flows through to the invoice.
          isEditable={isMoneyEditableForOrder}
          data={discountsData}
          onChange={fetchOrder}
        />

        {order.lineItems.length > 0 && (
          <div className="px-6 py-4 border-t border-lt-hairline flex justify-end">
            <div className="w-[280px] space-y-1.5 text-sm">
              <div className="flex justify-between text-lt-fg2">
                <span>Subtotal</span><span className="font-mono text-lt-fg2">{fmt(order.subtotal)}</span>
              </div>
              {/* Per-department discount lines render between Subtotal
                  and Tax when present. When breakdown is unavailable
                  or there are no discounts, this collapses to nothing
                  and the original layout is preserved. */}
              {discountsData?.breakdown.byDepartment
                .filter((d) => d.discount > 0)
                .map((d) => (
                  <div key={d.department} className="flex justify-between text-chip-bad-fg text-xs">
                    <span>{(d.discountLabel || 'Discount') + ` — ${d.department}`}</span>
                    <span className="font-mono">−{fmt(d.discount)}</span>
                  </div>
                ))}
              {discountsData && discountsData.breakdown.orderDiscount > 0 && (
                <div className="flex justify-between text-chip-bad-fg text-xs">
                  <span>{discountsData.breakdown.orderDiscountLabel || 'Order discount'}</span>
                  <span className="font-mono">−{fmt(discountsData.breakdown.orderDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-lt-fg2">
                <span>Tax ({(Number(order.taxRate) * 100).toFixed(1)}%)</span><span className="font-mono text-lt-fg2">{fmt(order.taxAmount)}</span>
              </div>
              <div className="flex justify-between text-lt-fg font-semibold pt-1.5 border-t border-lt-hairline">
                <span>Total</span><span className="font-mono">{fmt(order.total)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-lt-card border border-lt-hairline rounded-xl p-6">
        <h2 className="text-lg font-semibold text-lt-fg mb-3">Notes</h2>
        <p className="text-lt-fg2 text-sm whitespace-pre-wrap">{order.notes || "No notes."}</p>
        <p className="text-xs text-lt-fg3 mt-4">
          Created {new Date(order.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {/* Blind handoff capture — sales sets when the client picks up
          or returns their unit without a SirReel rep present. Toggles
          reveal the instructions textarea so we don't dump a textbox
          on every order; instructions surface on the portal job page
          when the toggle is on, and a loud check-in alert lights up
          the inbound dispatch lane when blindReturn fires. */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold text-lt-fg">Blind handoff</h2>
          <button
            onClick={saveBlindHandoff}
            disabled={!blindDirty || blindSaving}
            className="text-xs font-semibold bg-lt-fg hover:bg-black text-white px-3 py-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {blindSaving ? "Saving…" : blindDirty ? "Save" : "Saved"}
          </button>
        </div>
        <p className="text-xs text-lt-fg3 mb-4">
          Turn on when the client handles the unit themselves. Instructions show on their portal page; a return alert lights up Fleet Dispatch so the unit doesn't sit in the lot unprocessed.
        </p>

        <div className="space-y-4">
          {/* Pickup */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-lt-fg cursor-pointer">
              <input
                type="checkbox"
                checked={blindPickup}
                onChange={(e) => { setBlindPickup(e.target.checked); setBlindDirty(true); }}
                className="accent-lt-fg"
              />
              <span className="font-medium">Blind pickup</span>
              <span className="text-xs text-lt-fg3">Client picks up the unit themselves</span>
            </label>
            {blindPickup && (
              <textarea
                value={blindPickupInstructions}
                onChange={(e) => { setBlindPickupInstructions(e.target.value); setBlindDirty(true); }}
                rows={4}
                placeholder="Where the unit will be staged, gate code, lockbox combination, keys location, where to park, who to call after-hours…"
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2 resize-y"
              />
            )}
          </div>

          {/* Return */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-lt-fg cursor-pointer">
              <input
                type="checkbox"
                checked={blindReturn}
                onChange={(e) => { setBlindReturn(e.target.checked); setBlindDirty(true); }}
                className="accent-lt-fg"
              />
              <span className="font-medium">Blind return</span>
              <span className="text-xs text-lt-fg3">Client returns the unit themselves</span>
            </label>
            {blindReturn && (
              <textarea
                value={blindReturnInstructions}
                onChange={(e) => { setBlindReturnInstructions(e.target.value); setBlindDirty(true); }}
                rows={4}
                placeholder="Where to leave the unit, return-window hours, drop-off location, key drop, anything ops needs to know to find it…"
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2 resize-y"
              />
            )}
          </div>
        </div>

        {blindMsg && (
          <div className={`mt-3 text-xs ${blindMsg === "Saved." ? "text-chip-good-fg" : "text-chip-bad-fg"}`}>
            {blindMsg}
          </div>
        )}
      </div>

      {/* Phase 3 lane progress — visible only during the BOOKED →
          LOADED_READY arc. Shows the bilateral lane state that drives
          the rollup, plus the fleet-ready manual stamp button (until
          the digital fleet checkout flow lands). */}
      {(order.status === 'BOOKED' || order.status === 'LOADED_READY') && (() => {
        const warehouseLines = order.lineItems.filter((l) => l.fulfillmentLane === 'WAREHOUSE');
        const warehouseLoaded = warehouseLines.filter((l) => l.pickStatus === 'LOADED').length;
        const fleetLines = order.lineItems.filter((l) => l.fulfillmentLane === 'FLEET');
        const warehouseDone = warehouseLines.length === 0 || warehouseLoaded === warehouseLines.length;
        const fleetDone = fleetLines.length === 0 || !!order.fleetReadyAt;
        const bothDone = warehouseDone && fleetDone;
        return (
          <div className="bg-lt-card border border-lt-hairline rounded-xl px-6 py-4 mb-6">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold text-lt-fg">Fulfillment lanes</h2>
              {bothDone ? (
                <span className="text-[11px] font-semibold text-chip-good-fg">Both lanes ready ✓</span>
              ) : (
                <span className="text-[11px] text-lt-fg3">
                  {!warehouseDone && !fleetDone
                    ? 'Warehouse + fleet pending'
                    : !warehouseDone
                      ? 'Warehouse pending'
                      : 'Fleet pending'}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Warehouse cell */}
              <div className={`rounded-lg border px-3 py-2.5 ${warehouseDone ? 'border-chip-good-fg/30 bg-chip-good-bg' : 'border-lt-hairline bg-lt-inner'}`}>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">Warehouse</div>
                {warehouseLines.length === 0 ? (
                  <div className="text-sm text-lt-fg2 mt-0.5">No warehouse lines</div>
                ) : (
                  <div className="flex items-baseline justify-between mt-0.5">
                    <div className={`text-sm font-semibold ${warehouseDone ? 'text-chip-good-fg' : 'text-lt-fg'}`}>
                      {warehouseLoaded} / {warehouseLines.length} loaded
                    </div>
                    {!warehouseDone && (
                      <Link href="/warehouse/pick" className="text-[11px] text-lt-fg hover:text-black">
                        Picking floor →
                      </Link>
                    )}
                  </div>
                )}
              </div>
              {/* Fleet cell */}
              <div className={`rounded-lg border px-3 py-2.5 ${fleetDone ? 'border-chip-good-fg/30 bg-chip-good-bg' : 'border-lt-hairline bg-lt-inner'}`}>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">Fleet</div>
                {fleetLines.length === 0 ? (
                  <div className="text-sm text-lt-fg2 mt-0.5">No fleet lines</div>
                ) : (
                  <div className="flex items-center justify-between mt-0.5 gap-2">
                    <div className={`text-sm font-semibold ${fleetDone ? 'text-chip-good-fg' : 'text-lt-fg'}`}>
                      {order.fleetReadyAt
                        ? `Ready · ${new Date(order.fleetReadyAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                        : `${fleetLines.length} line${fleetLines.length === 1 ? '' : 's'} pending`}
                    </div>
                    {order.fleetReadyAt && (
                      // The wrapper conditional limits this whole panel
                      // to BOOKED / LOADED_READY; the server endpoint
                      // also guards against undo past ON_JOB.
                      <button
                        onClick={undoFleetReady}
                        disabled={fleetBusy != null}
                        title="Clear fleet-ready stamp"
                        className="text-[11px] text-lt-fg3 hover:text-chip-bad-fg underline-offset-2 hover:underline disabled:opacity-40"
                      >
                        {fleetBusy === 'undo' ? 'Undoing…' : 'Undo'}
                      </button>
                    )}
                    {!order.fleetReadyAt && order.status === 'BOOKED' && (
                      <button
                        onClick={stampFleetReady}
                        disabled={fleetBusy != null}
                        className="text-[11px] font-semibold bg-cadence-on-rental-bar hover:opacity-90 text-white px-2.5 py-1 rounded disabled:opacity-50"
                      >
                        {fleetBusy === 'stamp' ? 'Stamping…' : 'Mark Fleet Ready'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {fleetErr && (
              <div className="mt-3 text-[11px] text-chip-bad-fg">{fleetErr}</div>
            )}
          </div>
        );
      })()}

      {/* Quote PDF actions */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl px-6 py-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-lt-fg">Quote PDF</div>
          <div className="text-xs text-lt-fg3 mt-0.5">
            {order.quotePdfUrl
              ? `Last generated ${order.quotePdfGeneratedAt ? new Date(order.quotePdfGeneratedAt).toLocaleString() : ""}`
              : "Not generated yet"}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {order.quotePdfUrl ? (
            <>
              <a
                href={`/api/orders/${orderId}/quote-pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline text-lt-fg text-sm font-semibold rounded-lg"
              >
                Preview
              </a>
              <a
                href={`/api/orders/${orderId}/quote-pdf?download=1`}
                className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline text-lt-fg text-sm font-semibold rounded-lg"
              >
                Download
              </a>
              <button
                onClick={regeneratePdf}
                disabled={regeneratingPdf}
                className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline disabled:opacity-50 text-lt-fg text-sm font-semibold rounded-lg"
                title="Re-render the PDF off the current line items and totals"
              >
                {regeneratingPdf ? "Regenerating…" : "Regenerate"}
              </button>
              <div className="flex flex-col items-end gap-1">
                <button
                  disabled
                  className="px-3 py-1.5 bg-lt-inner text-lt-fg3 text-sm font-semibold rounded-lg cursor-not-allowed"
                  title={
                    noRecipient
                      ? "Add a contact to the job before sending."
                      : "Coming soon — email the quote PDF to the client"
                  }
                >
                  Send to Client
                </button>
                <RecipientLine recipients={recipients} onAdd={() => setAddContactOpen(true)} />
              </div>
            </>
          ) : (
            <button
              onClick={regeneratePdf}
              disabled={regeneratingPdf || order.lineItems.length === 0}
              className="px-3 py-1.5 bg-lt-fg hover:bg-black disabled:opacity-50 disabled:bg-lt-inner text-white text-sm font-semibold rounded-lg"
              title={order.lineItems.length === 0 ? "Add at least one line item first" : "Generate the client-facing Quote PDF"}
            >
              {regeneratingPdf ? "Generating…" : "Generate Quote PDF"}
            </button>
          )}
        </div>
      </div>

      {/* Quote follow-up (Mode A) — only renders when a quote has been sent. */}
      <QuoteFollowUpPanel orderId={orderId} isQuoteSent={order.status === "QUOTE_SENT"} />

      <EmailDeliveriesPanel deliveries={order.emailDeliveries} />

      {/* Cadence (CRH) */}
      {cadence && (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 mb-6 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-lt-fg">Email cadence</h2>
              <div className="text-xs text-lt-fg3 mt-0.5">
                State: <span className="text-lt-fg font-mono">{cadence.order.cadenceState}</span>
                {cadence.order.cadencePausedUntil && (
                  <>
                    {" · "}
                    paused until {new Date(cadence.order.cadencePausedUntil).toLocaleString()}
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {cadence.order.cadencePausedUntil && (
                <button
                  onClick={clearCadencePause}
                  disabled={cadenceBusy}
                  className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline disabled:opacity-50 text-lt-fg text-sm font-semibold rounded-lg"
                >
                  Clear pause
                </button>
              )}
              <button
                onClick={() => toggleCadenceOverride(!cadence.order.cadenceManualOverride)}
                disabled={cadenceBusy}
                className={`px-3 py-1.5 disabled:opacity-50 text-sm font-semibold rounded-lg ${
                  cadence.order.cadenceManualOverride
                    ? 'bg-lt-fg hover:bg-black text-white'
                    : 'bg-lt-inner hover:bg-lt-hairline text-lt-fg'
                }`}
              >
                {cadence.order.cadenceManualOverride ? 'Resume auto-cadence' : 'Pause auto-cadence'}
              </button>
            </div>
          </div>
          {cadence.events.length > 0 && (
            <div className="border-t border-lt-hairline pt-3">
              <div className="text-xs text-lt-fg3 uppercase tracking-wider font-semibold mb-2">
                Scheduled events ({cadence.events.length})
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {cadence.events.map((e) => {
                  const status = e.executedAt
                    ? e.skipped
                      ? `skipped${e.skipReason ? ` · ${e.skipReason}` : ''}`
                      : 'sent'
                    : 'pending';
                  return (
                    <div key={e.id} className="text-xs font-mono flex items-center justify-between gap-2 text-lt-fg2">
                      <span className="truncate">{e.eventType}</span>
                      <span className="text-lt-fg3">{new Date(e.scheduledFor).toLocaleString()}</span>
                      <span
                        className={`flex-shrink-0 ${
                          status === 'sent' ? 'text-chip-good-fg' : status === 'pending' ? 'text-lt-fg' : 'text-lt-fg3'
                        }`}
                      >
                        {status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stage Booking Terms — shown when the order has a stage line item
          (category slug contains "stage") or the line-items contain anything
          flagged as a stage rental. Sales fills in negotiated terms here,
          then generates the pre-signed stage contract for client countersign. */}
      {order.lineItems.some((li) => /stage/i.test(li.assetCategory?.name || "") || li.type === "STAGE") && (
        <StageBookingTermsSection orderId={order.id} />
      )}

      {/* Signed Agreement */}
      {agreement && (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 mb-6 space-y-4">
          {/* Standing-agreement banner — renders when this order was
              auto-pointed at the Company's negotiated PDF (step b of
              the negotiated-terms work). Soft past-review marker when
              the company's reviewDueDate has passed; we never
              auto-revert and never block sending. */}
          {standingAgreement && (() => {
            const reviewDue = standingAgreement.reviewDueDate ? new Date(standingAgreement.reviewDueDate) : null;
            const pastReview = reviewDue ? reviewDue.getTime() < Date.now() : false;
            return (
              <div className={`rounded-lg border px-3 py-2.5 ${pastReview ? 'border-chip-bad-fg/40 bg-chip-bad-bg' : 'border-chip-warn-fg/30 bg-chip-warn-bg'}`}>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${pastReview ? 'text-chip-bad-fg' : 'text-chip-warn-fg'}`}>
                    {pastReview ? 'Standing terms · past review' : 'Standing terms in use'}
                  </span>
                  <a
                    href={standingAgreement.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`text-[11px] font-semibold ${pastReview ? 'text-chip-bad-fg' : 'text-chip-warn-fg'} hover:opacity-80`}
                  >
                    Open PDF ↗
                  </a>
                </div>
                <p className={`text-[12px] mt-1 ${pastReview ? 'text-chip-bad-fg' : 'text-chip-warn-fg'}`}>
                  Using {standingAgreement.companyName}'s negotiated terms (established {fmtDate(standingAgreement.approvedAt)}).
                </p>
                {standingAgreement.summary && (
                  <p className={`text-[11px] mt-1 whitespace-pre-wrap ${pastReview ? 'text-chip-bad-fg' : 'text-chip-warn-fg'}`}>
                    {standingAgreement.summary}
                  </p>
                )}
                {pastReview && (
                  <p className="text-[11px] mt-1 text-chip-bad-fg">
                    Review-due date has passed. This order still uses the standing PDF — consider re-papering with the client.
                  </p>
                )}
              </div>
            );
          })()}

          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-lt-fg">Rental Agreement</h2>
              <div className="text-xs text-lt-fg3 mt-0.5">
                {agreement.documentType === "NEGOTIATED" ? "Negotiated" : "Baseline"}
                {agreement.baselineVersion ? ` · v${agreement.baselineVersion}` : ""}
                {" · "}
                Updated {new Date(agreement.updatedAt).toLocaleString()}
              </div>
            </div>
            {(() => {
              const desc = describeAgreementStatus(agreement.status as AgreementStatus);
              return (
                <span
                  className={`px-2.5 py-0.5 rounded text-xs font-medium ${desc.adminBadge}`}
                  title={desc.status}
                >
                  {desc.label}
                </span>
              );
            })()}
          </div>

          {/* Release-gate — visible only on PORTAL_GENERATED. Mid-
              negotiation, signed, and other downstream states hide
              this entirely (the manual-override strip below still
              allows admin recovery flips if needed). */}
          {agreement.status === "PORTAL_GENERATED" && (
            <div className="border border-chip-warn-fg/30 bg-chip-warn-bg rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-chip-warn-fg">
                <div className="font-semibold text-chip-warn-fg">Not yet visible to the client.</div>
                <div className="mt-0.5">
                  The PDF is ready; release it to the portal to let the client view + sign it
                  in-session.
                </div>
              </div>
              <button
                onClick={releaseAgreementToPortal}
                disabled={agreementBusy || !agreement.documentToSignUrl}
                title={
                  !agreement.documentToSignUrl
                    ? "Regenerate the agreement before releasing — no PDF on file"
                    : "Release to the client portal"
                }
                className="px-3 py-1.5 bg-lt-fg hover:bg-black disabled:bg-lt-inner disabled:text-lt-fg3 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg whitespace-nowrap"
              >
                Release to portal
              </button>
            </div>
          )}

          {(agreement.signedAt || agreement.signerName) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-lt-inner border border-lt-hairline rounded-lg p-4">
              <div>
                <div className="text-lt-fg3 text-xs">Signed at</div>
                <div className="text-lt-fg mt-0.5">
                  {agreement.signedAt ? new Date(agreement.signedAt).toLocaleString() : "—"}
                </div>
              </div>
              <div>
                <div className="text-lt-fg3 text-xs">Signer</div>
                <div className="text-lt-fg mt-0.5">{agreement.signerName || "—"}</div>
              </div>
              <div>
                <div className="text-lt-fg3 text-xs">Title</div>
                <div className="text-lt-fg mt-0.5">{agreement.signerTitle || "—"}</div>
              </div>
              <div>
                <div className="text-lt-fg3 text-xs">Email</div>
                <div className="text-lt-fg mt-0.5 break-all">{agreement.signerEmail || "—"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-lt-fg3 text-xs">IP address</div>
                <div className="text-lt-fg mt-0.5">{agreement.signerIpAddress || "—"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-lt-fg3 text-xs">User agent</div>
                <div className="text-lt-fg mt-0.5 text-xs break-all">{agreement.signerUserAgent || "—"}</div>
              </div>
              {agreement.acknowledgmentText && (
                <div className="col-span-full">
                  <div className="text-lt-fg3 text-xs">Acknowledgment</div>
                  <div className="text-lt-fg2 mt-0.5 text-xs leading-relaxed italic">
                    &ldquo;{agreement.acknowledgmentText}&rdquo;
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {portalUrl && (
              <a
                href={portalUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline text-lt-fg text-sm font-semibold rounded-lg"
              >
                Open portal as client ↗
              </a>
            )}
            {agreement.documentToSignUrl && (
              <a
                href={agreement.documentToSignUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline text-lt-fg text-sm font-semibold rounded-lg"
              >
                Doc to sign
              </a>
            )}
            {agreement.wordDocumentUrl && (
              <a
                href={agreement.wordDocumentUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline text-lt-fg text-sm font-semibold rounded-lg"
              >
                Last .docx download
              </a>
            )}
            {agreement.redlineUploadUrl && (
              <a
                href={agreement.redlineUploadUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline text-lt-fg text-sm font-semibold rounded-lg"
              >
                Client redline
              </a>
            )}
            {agreement.signedDocumentUrl && (
              <a
                href={agreement.signedDocumentUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-cadence-on-rental-bar hover:opacity-90 text-white text-sm font-semibold rounded-lg"
              >
                Signed PDF
              </a>
            )}
            {agreement.contractReviewId && (
              <a
                href={`/tools/contract-review/${agreement.contractReviewId}`}
                className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline text-lt-fg text-sm font-semibold rounded-lg"
              >
                Open contract review
              </a>
            )}
            <button
              onClick={resendPortalLink}
              disabled={agreementBusy || !portalLinkPrecondition.ok}
              title={portalLinkPrecondition.ok ? undefined : portalLinkPrecondition.reason}
              className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline disabled:opacity-50 disabled:cursor-not-allowed text-lt-fg text-sm font-semibold rounded-lg"
            >
              Resend portal link
            </button>
          </div>

          {/* Manual override — recovery only. Signed states are intentionally absent. */}
          <div className="border-t border-lt-hairline pt-4 space-y-2">
            <div className="text-xs text-lt-fg3 uppercase tracking-wider font-semibold">
              Manual override
            </div>
            <div className="flex flex-wrap gap-2">
              {RECOVERABLE_AGREEMENT_STATES
                .filter((s) => s !== agreement.status)
                .map((s) => (
                  <button
                    key={s}
                    onClick={() => overrideAgreementStatus(s)}
                    disabled={agreementBusy}
                    className="px-2.5 py-1 bg-lt-inner hover:bg-lt-inner disabled:opacity-50 border border-lt-hairline text-lt-fg2 text-xs font-semibold rounded"
                  >
                    → {describeAgreementStatus(s).label}
                  </button>
                ))}
            </div>
            <div className="text-[10px] text-lt-fg3">
              Recovery only — SIGNED_BASELINE / SIGNED_NEGOTIATED are never settable here (signing event required).
            </div>
          </div>

          {agreementMsg && (
            <div className="text-xs text-lt-fg2 bg-lt-inner border border-lt-hairline rounded-lg p-2">
              {agreementMsg}
            </div>
          )}
          {/* Prominent failure banner — distinct from the quiet
              agreementMsg strip above. Resend-link 4xx errors are the
              most common confusion point ("I clicked, nothing
              happened") so the rep gets a red-bordered, dismissible
              alert at the BOTTOM of the agreement section where their
              eye is already focused after the button click. */}
          {portalLinkError && (
            <div className="bg-chip-bad-bg border border-chip-bad-fg/40 rounded-lg p-3 flex items-start justify-between gap-3">
              <div className="text-sm text-chip-bad-fg">
                <div className="font-semibold mb-0.5">Portal link not sent</div>
                <div className="text-xs">{portalLinkError}</div>
              </div>
              <button
                type="button"
                onClick={() => setPortalLinkError(null)}
                className="text-chip-bad-fg hover:opacity-70 text-lg leading-none -mt-1"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {/* Phase 5 commit 4 — L&D disposition. Visible from RETURNED on
          (CLOSED retained — closed-with-open-LD is reachable per the
          non-blocking doctrine). */}
      {['RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED'].includes(order.status) && (
        <LdDispositionPanel orderId={orderId} onChanged={() => Promise.all([fetchOrder(), fetchInvoices()])} />
      )}

      {/* Phase 5 commit 1 — Invoices block. RW billing off-ramp:
          generate a native RENTAL invoice from the booked snapshot. */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="text-lg font-semibold text-lt-fg">Invoices</h2>
            <div className="text-xs text-lt-fg3 mt-0.5">
              Native SirReel billing. Rental invoice anchors to the booked value snapshot.
            </div>
          </div>
          {(() => {
            const hasActiveRental = (invoices || []).some(
              (i) => i.type === 'RENTAL' && i.status !== 'VOID',
            );
            const canGenerate = !hasActiveRental && order.bookedTotal != null;
            const title = order.bookedTotal == null
              ? 'Book the order before invoicing.'
              : hasActiveRental
                ? 'A RENTAL invoice already exists. Void it before regenerating.'
                : undefined;
            return (
              <button
                onClick={generateRentalInvoice}
                disabled={!canGenerate || generatingInvoice}
                title={title}
                className="px-3 py-1.5 bg-lt-fg hover:bg-black disabled:bg-lt-inner disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg"
              >
                {generatingInvoice ? 'Generating…' : 'Generate rental invoice'}
              </button>
            );
          })()}
        </div>

        {invoiceErr && (
          <div className="mb-3 rounded-lg border border-chip-bad-fg/40 bg-chip-bad-bg text-chip-bad-fg text-xs px-3 py-2">
            {invoiceErr}
          </div>
        )}

        {invoices === null ? (
          <div className="text-xs text-lt-fg3">Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div className="text-xs text-lt-fg3 border border-dashed border-lt-hairline rounded-lg px-3 py-4 text-center">
            No invoices yet.
          </div>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => {
              const expanded = expandedInvoiceId === inv.id;
              const canRecordPayment =
                inv.status === 'SENT' || inv.status === 'PARTIAL';
              const balanceNum = Number(inv.balanceDue);
              return (
                <div
                  key={inv.id}
                  className="border border-lt-hairline bg-lt-inner rounded-lg"
                >
                  <div className="flex items-center gap-3 flex-wrap px-3 py-2.5">
                    <button
                      onClick={() => toggleInvoiceRow(inv.id)}
                      className="text-lt-fg3 hover:text-lt-fg text-xs w-4"
                    >
                      {expanded ? '−' : '+'}
                    </button>
                    <span className="font-mono text-[11px] text-lt-fg2">{inv.invoiceNumber}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-lt-inner text-lt-fg2">
                      {inv.type}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                        inv.status === 'PAID'    ? 'bg-chip-good-bg text-chip-good-fg border-chip-good-fg/30' :
                        inv.status === 'SENT'    ? 'bg-cadence-booked-bg text-cadence-booked-fg border-cadence-booked-fg/30' :
                        inv.status === 'PARTIAL' ? 'bg-chip-warn-bg text-chip-warn-fg border-chip-warn-fg/30' :
                        inv.status === 'VOID'    ? 'bg-chip-bad-bg text-chip-bad-fg' :
                                                   'bg-lt-inner text-lt-fg2 border-lt-hairline'
                      }`}
                    >
                      {inv.status}
                    </span>
                    <span className="text-sm text-lt-fg font-semibold ml-auto">
                      ${Number(inv.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                    {Number(inv.amountPaid) > 0 && (
                      <span className="text-[11px] text-chip-good-fg">
                        −${Number(inv.amountPaid).toLocaleString('en-US', { minimumFractionDigits: 2 })} paid
                      </span>
                    )}
                    {balanceNum > 0 && inv.status !== 'DRAFT' && (
                      <span className="text-[11px] text-lt-fg">
                        ${balanceNum.toLocaleString('en-US', { minimumFractionDigits: 2 })} due
                      </span>
                    )}
                    <div className="text-[10px] text-lt-fg3 w-full md:w-auto md:ml-3">
                      Issued {new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {inv.dueDate && (
                        <> · due {new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
                      )}
                    </div>
                    {inv.pdfUrl && (
                      <a
                        href={`/api/invoices/${inv.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-semibold text-lt-fg hover:text-black"
                      >
                        View PDF →
                      </a>
                    )}
                    {inv.status === 'DRAFT' && (
                      <button
                        onClick={() => sendInvoice(inv.id)}
                        disabled={sendingInvoiceId != null || noRecipient}
                        title={noRecipient ? 'Add a contact to the job before sending.' : undefined}
                        className="text-[11px] font-semibold bg-cadence-on-rental-bar hover:opacity-90 disabled:bg-lt-inner disabled:opacity-60 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded"
                      >
                        {sendingInvoiceId === inv.id ? 'Sending…' : 'Send'}
                      </button>
                    )}
                    {inv.sentAt && inv.status !== 'DRAFT' && (
                      <span className="text-[10px] text-lt-fg3">
                        Sent {new Date(inv.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  {expanded && (
                    <div className="border-t border-lt-hairline px-3 py-3 space-y-3 bg-lt-card">
                      <PaymentsPanel
                        invoiceId={inv.id}
                        balanceDue={balanceNum}
                        canRecord={canRecordPayment}
                        payments={paymentsByInvoice[inv.id] ?? null}
                        recording={recordingPayment}
                        err={paymentErr}
                        onRecord={(body) => recordPayment(inv.id, body)}
                        onVoid={(paymentId) => voidPayment(paymentId, inv.id)}
                      />
                      {inv.type === 'LD' && (
                        <ClaimPanel invoiceId={inv.id} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Portal Access */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 mb-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-lt-fg">Portal access</h2>
            <div className="text-xs text-lt-fg3 mt-0.5">
              Per-contact magic links · 7-day TTL · 30-day session.{' '}
              <span className="text-lt-fg3">Add new contacts via &ldquo;+ Add quote recipient&rdquo; above.</span>
            </div>
          </div>
        </div>

        {/* Active accesses */}
        {accesses === null ? (
          <div className="text-xs text-lt-fg3">Loading…</div>
        ) : accesses.length === 0 ? (
          <div className="text-xs text-lt-fg3">No portal access issued yet.</div>
        ) : (
          <div className="border border-lt-hairline rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-lt-inner text-lt-fg3">
                <tr>
                  <th className="text-left p-2 font-semibold">Contact</th>
                  <th className="text-left p-2 font-semibold">Status</th>
                  <th className="text-left p-2 font-semibold">Last accessed</th>
                  <th className="text-right p-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lt-hairline">
                {accesses.map((a) => {
                  const expired = new Date(a.magicLinkExpiresAt).getTime() < Date.now();
                  const status = a.revokedAt ? 'Revoked' : expired ? 'Expired' : a.accessCount > 0 ? 'Active' : 'Invited';
                  const statusColor = a.revokedAt
                    ? 'bg-lt-inner text-lt-fg2'
                    : expired
                    ? 'bg-chip-warn-bg text-chip-warn-fg'
                    : a.accessCount > 0
                    ? 'bg-chip-good-bg text-chip-good-fg'
                    : 'bg-cadence-booked-bg text-cadence-booked-fg';
                  return (
                    <tr key={a.id}>
                      <td className="p-2">
                        <div className="text-lt-fg">{a.contact ? `${a.contact.firstName} ${a.contact.lastName}` : '—'}</div>
                        <div className="text-lt-fg3 text-[10px]">{a.contact?.email || '—'}</div>
                      </td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${statusColor}`}>{status}</span>
                      </td>
                      <td className="p-2 text-lt-fg3">
                        {a.lastAccessedAt ? new Date(a.lastAccessedAt).toLocaleString() : '—'}
                        {a.accessCount > 0 && <span className="text-lt-fg3"> · {a.accessCount}x</span>}
                      </td>
                      <td className="p-2 text-right">
                        <div className="inline-flex gap-2">
                          {!a.revokedAt && (
                            <>
                              {a.contact && (
                                <button
                                  onClick={() => regenerateAccess(a.contact!.id)}
                                  className="text-lt-fg2 hover:text-lt-fg text-[11px]"
                                >
                                  Regenerate
                                </button>
                              )}
                              <button
                                onClick={() => revokeAccess(a.id)}
                                className="text-chip-bad-fg hover:opacity-70 text-[11px]"
                              >
                                Revoke
                              </button>
                            </>
                          )}
                          {a.revokedAt && a.contact && (
                            <button
                              onClick={() => regenerateAccess(a.contact!.id)}
                              className="text-chip-good-fg hover:opacity-70 text-[11px]"
                            >
                              Reactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Detected contacts */}
        {detected.length > 0 && (
          <div className="border-t border-lt-hairline pt-4">
            <div className="text-xs text-lt-fg3 uppercase tracking-wider font-semibold mb-2">
              New contact{detected.length === 1 ? '' : 's'} detected on this company&rsquo;s email threads
            </div>
            <div className="space-y-2">
              {detected.map((d) => (
                <div key={d.email} className="flex items-center justify-between gap-3 bg-lt-inner border border-lt-hairline rounded-lg p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-lt-fg text-sm truncate">{d.displayName}</div>
                    <div className="text-lt-fg3 text-[10px] truncate">
                      {d.email} · last seen {new Date(d.mostRecentAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      directInvite({
                        email: d.email,
                        firstName: d.person?.firstName,
                        lastName: d.person?.lastName,
                      })
                    }
                    disabled={inviteBusy}
                    className="px-2.5 py-1 bg-lt-inner hover:bg-lt-hairline disabled:opacity-50 text-lt-fg text-[11px] font-semibold rounded"
                  >
                    Invite to portal
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The "Invite a new contact" form moved up to the header's
            "+ Add quote recipient" affordance so a single action creates
            both a JobContact and a PortalAccess. This section is now
            management-only — list/revoke/regenerate live access. */}
        {inviteMsg && (
          <div className="border-t border-lt-hairline pt-3 text-[11px] text-lt-fg2">{inviteMsg}</div>
        )}
      </div>

      <EmailReviewModal
        target={emailReviewTarget}
        onClose={() => setEmailReviewTarget(null)}
        onSent={(info) => {
          setEmailReviewTarget(null);
          setSendQuoteFlash(
            `Quote ${info.orderNumber} sent to ${info.recipient}.`
          );
          void fetchOrder();
          window.setTimeout(() => setSendQuoteFlash(null), 6000);
        }}
      />

      {sendQuoteFlash && (
        <div className="fixed bottom-6 right-6 z-40 bg-chip-good-bg border border-chip-good-fg/30 text-chip-good-fg text-sm px-4 py-2.5 rounded-lg shadow-lg">
          {sendQuoteFlash}
        </div>
      )}

      <LineItemUndoToast toast={lineItemUndoToast} />

      {pushDatesOpen && order.startDate && order.endDate && (
        <PushDatesModal
          orderId={order.id}
          currentStartDate={order.startDate}
          currentEndDate={order.endDate}
          postBooking={!["DRAFT", "QUOTE_SENT", "APPROVED"].includes(order.status)}
          onClose={() => setPushDatesOpen(false)}
          onChanged={() => { fetchOrder(); }}
        />
      )}
      </div>
    </div>
  );
}

function RecipientLine({
  recipients,
  onAdd,
}: {
  recipients: RecipientChoice;
  onAdd?: () => void;
}) {
  if (!recipients.primary) {
    if (onAdd) {
      return (
        <button
          type="button"
          onClick={onAdd}
          className="text-[11px] text-lt-fg hover:text-black underline decoration-dotted underline-offset-2"
        >
          + Add quote recipient
        </button>
      );
    }
    return (
      <div className="text-[11px] text-lt-fg">
        ⚠ No recipient — add a contact to send
      </div>
    );
  }
  const others = recipients.others;
  const tooltip = others.length
    ? others.map((o) => `${o.name} <${o.email}>${o.role ? ` · ${o.role}` : ''}${isHighRiskEmailDomain(o.email) ? '  ⚠ iCloud — may be filtered' : ''}`).join('\n')
    : undefined;
  const primaryRisky = isHighRiskEmailDomain(recipients.primary.email);
  return (
    <div className="text-[11px] text-lt-fg3 leading-tight">
      <span className="text-lt-fg3">→ </span>
      <a
        href={`/crm/people/${recipients.primary.id}`}
        className="text-lt-fg2 hover:text-lt-fg underline decoration-dotted underline-offset-2"
        title="Open contact"
      >
        {recipients.primary.email}
      </a>
      {primaryRisky && (
        <span
          className="ml-1.5 inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg whitespace-nowrap align-middle"
          title="Apple iCloud may silently filter mail to this address — confirm receipt or use another channel."
        >
          iCloud — may be filtered
        </span>
      )}
      {others.length > 0 && (
        <span className="text-lt-fg3 cursor-help" title={tooltip}>
          {' '}and {others.length} other{others.length === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}

function AddContactForm({
  email,
  first,
  last,
  role,
  grantPortal,
  busy,
  err,
  hasQuotePdf,
  onChange,
  onSubmit,
  onCancel,
}: {
  email: string;
  first: string;
  last: string;
  role: "PRODUCER" | "PM" | "PC" | "ACCOUNTING" | "OTHER";
  grantPortal: boolean;
  busy: boolean;
  err: string;
  hasQuotePdf: boolean;
  onChange: {
    email: (v: string) => void;
    first: (v: string) => void;
    last: (v: string) => void;
    role: (v: "PRODUCER" | "PM" | "PC" | "ACCOUNTING" | "OTHER") => void;
    grantPortal: (v: boolean) => void;
  };
  onSubmit: (andSendQuote: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <div className="bg-lt-inner border border-lt-hairline rounded-lg p-4 space-y-3">
      <div className="text-xs text-lt-fg3 uppercase tracking-wider font-semibold">Add quote recipient</div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <input
          value={email}
          onChange={(e) => onChange.email(e.target.value)}
          placeholder="email@example.com"
          type="email"
          autoFocus
          className="sm:col-span-2 bg-lt-card border border-lt-hairline rounded-lg px-3 py-2 text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2"
        />
        <input
          value={first}
          onChange={(e) => onChange.first(e.target.value)}
          placeholder="First name"
          className="bg-lt-card border border-lt-hairline rounded-lg px-3 py-2 text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2"
        />
        <input
          value={last}
          onChange={(e) => onChange.last(e.target.value)}
          placeholder="Last name"
          className="bg-lt-card border border-lt-hairline rounded-lg px-3 py-2 text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2"
        />
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-lt-fg2">
          Role
          <select
            value={role}
            onChange={(e) => onChange.role(e.target.value as typeof role)}
            className="bg-lt-card border border-lt-hairline rounded-lg px-2 py-1.5 text-sm text-lt-fg focus:outline-none focus:border-lt-fg2"
          >
            <option value="PRODUCER">Producer</option>
            <option value="PM">PM</option>
            <option value="PC">PC</option>
            <option value="ACCOUNTING">Accounting</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-lt-fg2 cursor-pointer">
          <input
            type="checkbox"
            checked={grantPortal}
            onChange={(e) => onChange.grantPortal(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          Also grant portal access (sends magic link)
        </label>
      </div>
      {err && <div className="text-[11px] text-chip-bad-fg">{err}</div>}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-lt-fg2 hover:text-lt-fg disabled:opacity-50 text-sm"
        >
          Cancel
        </button>
        {hasQuotePdf ? (
          <button
            onClick={() => onSubmit(true)}
            disabled={busy || !email.trim()}
            className="px-3 py-1.5 bg-lt-fg hover:bg-black disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
          >
            {busy ? "Adding…" : "Add and Send Quote"}
          </button>
        ) : (
          <button
            onClick={() => onSubmit(false)}
            disabled={busy || !email.trim()}
            className="px-3 py-1.5 bg-lt-fg hover:bg-black disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        )}
      </div>
    </div>
  );
}

// Phase 5 commit 3 — payment record + history panel rendered inline
// when an invoice row is expanded. Keeps the order detail page from
// needing a separate /payments surface — Ana works billing one
// order at a time.
function PaymentsPanel({
  invoiceId,
  balanceDue,
  canRecord,
  payments,
  recording,
  err,
  onRecord,
  onVoid,
}: {
  invoiceId: string;
  balanceDue: number;
  canRecord: boolean;
  payments: PaymentRow[] | null;
  recording: boolean;
  err: string | null;
  onRecord: (body: {
    amount: number;
    method: string;
    receivedAt: string;
    reference: string;
    notes: string;
  }) => void | Promise<void>;
  onVoid: (paymentId: string) => void | Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('CHECK');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const amountNum = parseFloat(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const overpay = validAmount && amountNum > balanceDue + 0.005;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validAmount || overpay) return;
    await onRecord({
      amount: amountNum,
      method,
      receivedAt,
      reference: reference.trim(),
      notes: notes.trim(),
    });
    setAmount('');
    setReference('');
    setNotes('');
  };
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider font-bold text-lt-fg3 mb-2">
          Payments
        </div>
        {payments === null ? (
          <div className="text-xs text-lt-fg3">Loading…</div>
        ) : payments.length === 0 ? (
          <div className="text-xs text-lt-fg3 italic">No payments recorded yet.</div>
        ) : (
          <div className="space-y-1.5">
            {payments.map((p) => {
              const voided = !!p.voidedAt;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 flex-wrap text-xs px-2.5 py-1.5 rounded border ${
                    voided
                      ? 'border-lt-hairline bg-lt-inner text-lt-fg3 line-through'
                      : 'border-lt-hairline bg-lt-inner text-lt-fg'
                  }`}
                >
                  <span className="font-semibold">
                    ${Number(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-lt-fg3">{p.method}</span>
                  {p.reference && <span className="text-[11px] text-lt-fg2">ref {p.reference}</span>}
                  <span className="text-[11px] text-lt-fg3">
                    Received {new Date(p.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="text-[11px] text-lt-fg3 ml-auto">
                    by {p.recordedBy.name}
                  </span>
                  {voided ? (
                    <span className="text-[10px] text-chip-bad-fg no-underline">
                      Voided · {p.voidReason}
                    </span>
                  ) : (
                    <button
                      onClick={() => onVoid(p.id)}
                      className="text-[10px] text-lt-fg3 hover:text-chip-bad-fg underline-offset-2 hover:underline"
                    >
                      Void
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canRecord && balanceDue > 0 && (
        <form
          onSubmit={submit}
          className="border border-lt-hairline rounded-lg p-3 grid grid-cols-12 gap-2 bg-lt-inner"
        >
          <label className="col-span-3 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
            Amount
            <div className="mt-1">
              <CurrencyInput
                value={Number(amount) || 0}
                onChange={(next) => setAmount(next === 0 ? '' : String(next))}
                min={0.01}
                max={balanceDue + 1000}
                placeholder={balanceDue.toFixed(2)}
                inputClassName="px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg outline-none focus:border-lt-fg2 normal-case tracking-normal"
                ariaLabel="Payment amount"
              />
            </div>
          </label>
          <label className="col-span-3 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
            Method
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="mt-1 px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg outline-none focus:border-lt-fg2 normal-case tracking-normal"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m.replace('_', ' ')}</option>
              ))}
            </select>
          </label>
          <label className="col-span-3 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
            Received
            <input
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              className="mt-1 px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg outline-none focus:border-lt-fg2 normal-case tracking-normal"
            />
          </label>
          <label className="col-span-3 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
            Reference
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Check #, wire id…"
              className="mt-1 px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg outline-none focus:border-lt-fg2 normal-case tracking-normal"
            />
          </label>
          <label className="col-span-9 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
            Notes (optional)
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg outline-none focus:border-lt-fg2 normal-case tracking-normal"
            />
          </label>
          <div className="col-span-3 flex items-end">
            <button
              type="submit"
              disabled={recording || !validAmount || overpay}
              title={
                overpay
                  ? `Amount exceeds balance due ($${balanceDue.toFixed(2)})`
                  : undefined
              }
              className="w-full px-3 py-1.5 bg-cadence-on-rental-bar hover:opacity-90 disabled:bg-lt-inner disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded"
            >
              {recording ? 'Recording…' : 'Record payment'}
            </button>
          </div>
          {overpay && (
            <div className="col-span-12 text-[11px] text-chip-bad-fg">
              Amount exceeds the ${balanceDue.toLocaleString('en-US', { minimumFractionDigits: 2 })} balance due.
            </div>
          )}
        </form>
      )}

      {err && (
        <div className="text-[11px] text-chip-bad-fg border border-chip-bad-fg/30 bg-chip-bad-bg rounded px-2 py-1.5">
          {err}
        </div>
      )}

      {!canRecord && (
        <div className="text-[11px] text-lt-fg3 italic">
          Payment recording opens once the invoice is sent.
        </div>
      )}

      {/* invoiceId reserved for future per-form analytics — referenced here
          so the unused-var lint stays quiet during tighter perms work. */}
      <span className="hidden">{invoiceId}</span>
    </div>
  );
}

// Phase 5 commit 4 — claim panel inside the expanded LD invoice row.
// Loads the existing claim if any; lets operator open one if none.
// Once opened, the full claim pipeline lives on the existing /claims
// surface — this panel just shows status + a link.
function ClaimPanel({ invoiceId }: { invoiceId: string }) {
  const [claim, setClaim] = useState<{
    id: string;
    claimNumber: string;
    status: string;
    filedAgainst: string;
    incidentDate: string;
    totalDemand: string | null;
    amountSettled: string | null;
    assignedToUser: { id: string; name: string } | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [posting, setPosting] = useState(false);
  const [filedAgainst, setFiledAgainst] = useState("");
  const [incidentDate, setIncidentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [incidentDescription, setIncidentDescription] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/invoices/${invoiceId}/claim`);
    if (r.ok) {
      const d = await r.json();
      setClaim(d.claim || null);
    } else {
      setErr(`HTTP ${r.status}`);
    }
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => { refresh(); }, [refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (posting) return;
    if (!filedAgainst.trim() || incidentDescription.trim().length < 10) return;
    setPosting(true);
    setErr(null);
    try {
      const r = await fetch(`/api/invoices/${invoiceId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filedAgainst: filedAgainst.trim(),
          incidentDate,
          incidentDescription: incidentDescription.trim(),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setErr(data.error || `HTTP ${r.status}`);
        return;
      }
      setShowForm(false);
      setFiledAgainst("");
      setIncidentDescription("");
      await refresh();
    } finally {
      setPosting(false);
    }
  };

  if (loading) return <div className="text-xs text-lt-fg3">Loading claim…</div>;

  return (
    <div className="border-t border-lt-hairline pt-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider font-bold text-lt-fg3">
        Insurance claim
      </div>
      {err && (
        <div className="text-[11px] text-chip-bad-fg border border-chip-bad-fg/30 bg-chip-bad-bg rounded px-2 py-1.5">
          {err}
        </div>
      )}
      {claim ? (
        <div className="bg-lt-inner border border-lt-hairline rounded-lg px-3 py-2 flex items-center gap-3 flex-wrap text-xs">
          <span className="font-mono text-[11px] text-lt-fg2">{claim.claimNumber}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-cadence-returning-today-bg text-cadence-returning-today-fg border border-cadence-returning-today-fg/30">
            {claim.status}
          </span>
          <span className="text-lt-fg2">filed against <span className="font-semibold">{claim.filedAgainst}</span></span>
          {claim.totalDemand && (
            <span className="text-lt-fg2">demand ${Number(claim.totalDemand).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
          )}
          {claim.amountSettled && (
            <span className="text-chip-good-fg">settled ${Number(claim.amountSettled).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
          )}
          {claim.assignedToUser && (
            <span className="text-lt-fg3 ml-auto">assigned {claim.assignedToUser.name}</span>
          )}
          <a
            href={`/claims/${claim.id}`}
            className="text-[11px] font-semibold text-lt-fg hover:text-black"
          >
            Open in claims →
          </a>
        </div>
      ) : showForm ? (
        <form onSubmit={submit} className="bg-lt-inner border border-lt-hairline rounded-lg p-3 grid grid-cols-12 gap-2">
          <label className="col-span-5 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
            Filed against
            <input
              type="text"
              value={filedAgainst}
              onChange={(e) => setFiledAgainst(e.target.value)}
              placeholder="Insurance company name"
              required
              className="mt-1 px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg outline-none focus:border-lt-fg2 normal-case tracking-normal"
            />
          </label>
          <label className="col-span-4 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
            Incident date
            <input
              type="date"
              value={incidentDate}
              onChange={(e) => setIncidentDate(e.target.value)}
              required
              className="mt-1 px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg outline-none focus:border-lt-fg2 normal-case tracking-normal"
            />
          </label>
          <label className="col-span-12 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
            Description (≥10 chars)
            <textarea
              value={incidentDescription}
              onChange={(e) => setIncidentDescription(e.target.value)}
              rows={3}
              required
              className="mt-1 px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg outline-none focus:border-lt-fg2 normal-case tracking-normal"
            />
          </label>
          <div className="col-span-12 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs font-semibold border border-lt-hairline text-lt-fg2 hover:border-lt-fg2 px-3 py-1.5 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={posting || incidentDescription.trim().length < 10 || !filedAgainst.trim()}
              className="text-xs font-semibold bg-chip-bad-fg hover:opacity-90 disabled:bg-lt-inner disabled:opacity-60 text-white px-3 py-1.5 rounded-lg"
            >
              {posting ? "Opening…" : "Open claim"}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="text-xs font-semibold bg-chip-bad-fg hover:opacity-90 text-white px-3 py-1.5 rounded-lg"
        >
          Open claim against carrier
        </button>
      )}
    </div>
  );
}

// Per-send delivery audit panel — surfaces Resend's lifecycle for
// every order-anchored email this order has sent. Each row is one
// dispatch; the status pill is updated by the
// /api/webhooks/resend handler as events arrive.
//   SENT       → grey neutral (accepted by Resend, not yet delivered)
//   DELIVERED  → green
//   DELAYED    → amber
//   BOUNCED    → red (statusDetail = bounce reason — type/subtype/msg)
//   COMPLAINED → red (recipient flagged as spam)
const DELIVERY_TONE: Record<EmailDeliveryStatus, string> = {
  SENT:       'bg-chip-neutral-bg text-chip-neutral-fg',
  DELIVERED:  'bg-chip-good-bg text-chip-good-fg',
  DELAYED:    'bg-chip-warn-bg text-chip-warn-fg',
  BOUNCED:    'bg-chip-bad-bg text-chip-bad-fg',
  COMPLAINED: 'bg-chip-bad-bg text-chip-bad-fg',
};

function fmtDeliveryAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function EmailDeliveriesPanel({ deliveries }: { deliveries: EmailDelivery[] }) {
  if (deliveries.length === 0) return null;
  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 mb-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-lg font-semibold text-lt-fg">Email delivery</h2>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
          {deliveries.length} {deliveries.length === 1 ? 'send' : 'sends'} · live from Resend
        </span>
      </div>
      <div className="space-y-2">
        {deliveries.map((d) => (
          <div
            key={d.id}
            className="border border-lt-hairline/50 rounded-lg px-3 py-2 flex items-center gap-3 flex-wrap"
          >
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${DELIVERY_TONE[d.status]}`}
              title={d.statusDetail ?? undefined}
            >
              {d.status}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-lt-fg truncate">{d.subject}</div>
              <div className="text-[11px] text-lt-fg3 truncate">
                to {d.toAddress}
                {d.label ? <span className="text-lt-fg3"> · {d.label}</span> : null}
              </div>
              {d.statusDetail && d.status !== 'SENT' && d.status !== 'DELIVERED' && (
                <div className="text-[11px] text-chip-bad-fg mt-0.5">{d.statusDetail}</div>
              )}
            </div>
            <div className="text-[11px] text-lt-fg3 whitespace-nowrap text-right">
              <div>sent {fmtDeliveryAt(d.sentAt)}</div>
              {d.status !== 'SENT' && (
                <div>{d.status.toLowerCase()} {fmtDeliveryAt(d.statusAt)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
