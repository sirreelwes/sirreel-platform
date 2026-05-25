"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { StageBookingTermsSection } from "@/components/orders/StageBookingTermsSection";

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
  booking: { id: string; bookingNumber: string; jobName: string; productionName: string | null } | null;
  jobContact: { id: string; firstName: string; lastName: string; email: string } | null;
  job: { id: string; jobCode: string; name: string; jobContacts: JobContactRow[] } | null;
  lineItems: LineItem[];
  invoices: { id: string; invoiceNumber: string; status: string; total: string }[];
  quotePdfKey: string | null;
  quotePdfUrl: string | null;
  quotePdfGeneratedAt: string | null;
};

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
type InvItem = { id: string; code: string; description: string; category: { id: string; name: string } };

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-700 text-zinc-300",
  QUOTE_SENT: "bg-amber-900/60 text-amber-300",
  CONFIRMED: "bg-blue-900/60 text-blue-300",
  ACTIVE: "bg-emerald-900/60 text-emerald-300",
  RETURNED: "bg-purple-900/60 text-purple-300",
  CLOSED: "bg-zinc-800 text-zinc-400",
  CANCELLED: "bg-red-900/60 text-red-300",
};

const LINE_TYPES = ["VEHICLE", "EQUIPMENT", "EXPENDABLE", "LABOR", "FEE", "DISCOUNT"] as const;

const STATUS_ACTIONS: Record<string, { label: string; next: string; color: string }[]> = {
  DRAFT: [{ label: "Send Quote", next: "QUOTE_SENT", color: "bg-amber-600 hover:bg-amber-500" }],
  QUOTE_SENT: [
    { label: "Confirm Order", next: "CONFIRMED", color: "bg-blue-600 hover:bg-blue-500" },
    { label: "Back to Draft", next: "DRAFT", color: "bg-zinc-600 hover:bg-zinc-500" },
  ],
  CONFIRMED: [{ label: "Mark Active", next: "ACTIVE", color: "bg-emerald-600 hover:bg-emerald-500" }],
  ACTIVE: [{ label: "Mark Returned", next: "RETURNED", color: "bg-purple-600 hover:bg-purple-500" }],
  RETURNED: [{ label: "Close Order", next: "CLOSED", color: "bg-zinc-600 hover:bg-zinc-500" }],
};

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params.id as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [assetCats, setAssetCats] = useState<AssetCat[]>([]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [liType, setLiType] = useState<string>("EQUIPMENT");
  const [liDesc, setLiDesc] = useState("");
  const [liAssetCatId, setLiAssetCatId] = useState("");
  const [liInvItemId, setLiInvItemId] = useState("");
  const [liStartDate, setLiStartDate] = useState("");
  const [liEndDate, setLiEndDate] = useState("");
  const [liRateType, setLiRateType] = useState("DAILY");
  const [liRate, setLiRate] = useState("");
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editDays, setEditDays] = useState("");
  const [liQty, setLiQty] = useState("1");
  const [adding, setAdding] = useState(false);

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

  // Send Quote modal state — opens from the existing Send Quote
  // action button. Replaces the prior bare-button which only flipped
  // status to QUOTE_SENT without actually emailing the client.
  const [sendQuoteOpen, setSendQuoteOpen] = useState(false);
  const [sendQuoteMessage, setSendQuoteMessage] = useState('');
  const [sendQuoteBusy, setSendQuoteBusy] = useState(false);
  const [sendQuoteResult, setSendQuoteResult] = useState<
    | { ok: true; emailId: string | null; recipient: { name: string; email: string }; cc: { email: string }[] }
    | { ok: false; error: string }
    | null
  >(null);

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "--";

  const fetchOrder = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}`);
    if (!res.ok) { router.push("/orders"); return; }
    const data = await res.json();
    setOrder(data);
    setLoading(false);
  }, [orderId, router]);

  // Inline "Add quote recipient" form state — opened from the
  // RecipientLine warning, creates a JobContact + optional PortalAccess
  // in a single POST.
  const [addContactOpen, setAddContactOpen] = useState(false);
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

  const fetchAgreement = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}/agreement`);
    if (!res.ok) return;
    const data = await res.json();
    setAgreement(data.agreement || null);
    setPortalUrl(data.portalUrl || null);
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

  const resendPortalLink = async () => {
    setAgreementBusy(true);
    setAgreementMsg("");
    try {
      const r = await fetch(`/api/orders/${orderId}/agreement/resend-link`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (data.portalUrl) setPortalUrl(data.portalUrl);
      if (!r.ok) {
        const portalSuffix = data.portalUrl ? ` Portal URL: ${data.portalUrl}` : "";
        setAgreementMsg((data.error || "Resend failed") + portalSuffix);
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

  useEffect(() => {
    if (showAddForm && order) {
      if (order.startDate && !liStartDate) setLiStartDate(order.startDate.split("T")[0]);
      if (order.endDate && !liEndDate) setLiEndDate(order.endDate.split("T")[0]);
    }
  }, [showAddForm, order]);

  const updateStatus = async (newStatus: string) => {
    await fetch(`/api/orders/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchOrder();
  };

  // Wraps POST /api/orders/[id]/send-quote — emails the client the
  // quote PDF and (for DRAFT orders) flips status to QUOTE_SENT.
  // Resends are safe: the endpoint sends but leaves quoteSentAt
  // untouched when status was already QUOTE_SENT.
  const sendQuote = async () => {
    setSendQuoteBusy(true);
    setSendQuoteResult(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/send-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: sendQuoteMessage.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSendQuoteResult({ ok: false, error: json.error || `HTTP ${res.status}` });
        return;
      }
      setSendQuoteResult({
        ok: true,
        emailId: json.emailId ?? null,
        recipient: json.recipient,
        cc: json.cc ?? [],
      });
      await fetchOrder();
    } catch (e) {
      setSendQuoteResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSendQuoteBusy(false);
    }
  };

  const closeSendQuote = () => {
    setSendQuoteOpen(false);
    setSendQuoteMessage("");
    setSendQuoteResult(null);
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

  const selectAssetCategory = (cat: AssetCat) => {
    setLiAssetCatId(cat.id);
    setLiDesc(cat.name);
    setLiRate(String(Number(cat.dailyRate)));
    setLiRateType("DAILY");
  };

  const selectInventoryItem = (item: InvItem) => {
    setLiInvItemId(item.id);
    setLiDesc(item.description || item.code);
    setInvSearch(item.code);
    setShowInvDropdown(false);
  };

  const resetForm = () => {
    setLiType("EQUIPMENT"); setLiDesc(""); setLiAssetCatId(""); setLiInvItemId("");
    setLiStartDate(order?.startDate?.split("T")[0] || "");
    setLiEndDate(order?.endDate?.split("T")[0] || "");
    setLiRateType("DAILY"); setLiRate(""); setLiQty("1");
    setInvSearch(""); setInvResults([]);
  };

  const addLineItem = async () => {
    if (!liDesc || !liRate) return;
    setAdding(true);
    await fetch(`/api/orders/${orderId}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: liType, description: liDesc,
        inventoryItemId: liInvItemId || null,
        assetCategoryId: liAssetCatId || null,
        startDate: liStartDate || null, endDate: liEndDate || null,
        rateType: liRateType, rate: parseFloat(liRate),
        quantity: parseInt(liQty) || 1,
      }),
    });
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

  const deleteLineItem = async (lineId: string) => {
    await fetch(`/api/orders/${orderId}/line-items/${lineId}`, { method: "DELETE" });
    fetchOrder();
  };

  if (loading || !order) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <p className="text-zinc-500">Loading order...</p>
      </div>
    );
  }

  const actions = STATUS_ACTIONS[order.status] || [];
  const isEditable = ["DRAFT", "QUOTE_SENT"].includes(order.status);
  const recipients = computeRecipients(order);
  const noRecipient = !recipients.primary;

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <button onClick={() => router.push("/orders")} className="text-sm text-zinc-400 hover:text-white mb-4 inline-block">
        &larr; Back to Orders
      </button>

      {/* Order Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold text-white font-mono">{order.orderNumber}</h1>
              <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[order.status]}`}>
                {order.status.replace("_", " ")}
              </span>
            </div>
            <p className="text-zinc-400">{order.description || "No description"}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-2">
              {actions.map((action) => {
                const isSendQuote = action.next === "QUOTE_SENT";
                const disabled = isSendQuote && (noRecipient || !order.quotePdfUrl);
                const title = isSendQuote
                  ? noRecipient
                    ? "Add a contact to the job before sending the quote."
                    : !order.quotePdfUrl
                      ? "Generate the quote PDF first."
                      : undefined
                  : undefined;
                return (
                  <button
                    key={action.next}
                    onClick={() => (isSendQuote ? setSendQuoteOpen(true) : updateStatus(action.next))}
                    disabled={disabled}
                    title={title}
                    className={`px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors ${action.color} disabled:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {action.label}
                  </button>
                );
              })}
              {order.status !== "CANCELLED" && order.status !== "CLOSED" && (
                <button onClick={cancelOrder} className="px-3 py-2 text-red-400 hover:text-red-300 text-sm">Cancel</button>
              )}
              {order.status === "DRAFT" && (
                <button onClick={deleteOrder} className="px-3 py-2 text-zinc-500 hover:text-red-400 text-sm">Delete</button>
              )}
            </div>
            {order.status === "DRAFT" && (
              <RecipientLine recipients={recipients} onAdd={() => setAddContactOpen(true)} />
            )}
          </div>
        </div>

        {addContactOpen && (
          <div className="mt-4 border-t border-zinc-800 pt-4">
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
          <div><span className="text-zinc-500">Company</span><p className="text-white mt-0.5">{order.company.name}</p></div>
          <div><span className="text-zinc-500">Agent</span><p className="text-white mt-0.5">{order.agent.name}</p></div>
          <div><span className="text-zinc-500">Dates</span><p className="text-white mt-0.5">{fmtDate(order.startDate)} - {fmtDate(order.endDate)}</p></div>
          <div><span className="text-zinc-500">Linked Booking</span><p className="text-white mt-0.5">
            {order.booking ? <a href={`/jobs/${order.booking.id}`} className="text-blue-400 hover:text-blue-300">{order.booking.bookingNumber}</a> : <span className="text-zinc-500">None</span>}
          </p></div>
        </div>
      </div>

      {/* Quote PDF actions */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">Quote PDF</div>
          <div className="text-xs text-zinc-500 mt-0.5">
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
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-lg"
              >
                Preview
              </a>
              <a
                href={`/api/orders/${orderId}/quote-pdf?download=1`}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-lg"
              >
                Download
              </a>
              <button
                onClick={regeneratePdf}
                disabled={regeneratingPdf}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
                title="Re-render the PDF off the current line items and totals"
              >
                {regeneratingPdf ? "Regenerating…" : "Regenerate"}
              </button>
              <div className="flex flex-col items-end gap-1">
                <button
                  disabled
                  className="px-3 py-1.5 bg-zinc-800 text-zinc-500 text-sm font-semibold rounded-lg cursor-not-allowed"
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
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:bg-zinc-700 text-white text-sm font-semibold rounded-lg"
              title={order.lineItems.length === 0 ? "Add at least one line item first" : "Generate the client-facing Quote PDF"}
            >
              {regeneratingPdf ? "Generating…" : "Generate Quote PDF"}
            </button>
          )}
        </div>
      </div>

      {/* Cadence (CRH) */}
      {cadence && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-white">Email cadence</h2>
              <div className="text-xs text-zinc-500 mt-0.5">
                State: <span className="text-white font-mono">{cadence.order.cadenceState}</span>
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
                  className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
                >
                  Clear pause
                </button>
              )}
              <button
                onClick={() => toggleCadenceOverride(!cadence.order.cadenceManualOverride)}
                disabled={cadenceBusy}
                className={`px-3 py-1.5 disabled:opacity-50 text-white text-sm font-semibold rounded-lg ${
                  cadence.order.cadenceManualOverride
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : 'bg-zinc-700 hover:bg-zinc-600'
                }`}
              >
                {cadence.order.cadenceManualOverride ? 'Resume auto-cadence' : 'Pause auto-cadence'}
              </button>
            </div>
          </div>
          {cadence.events.length > 0 && (
            <div className="border-t border-zinc-800 pt-3">
              <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">
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
                    <div key={e.id} className="text-xs font-mono flex items-center justify-between gap-2 text-zinc-400">
                      <span className="truncate">{e.eventType}</span>
                      <span className="text-zinc-600">{new Date(e.scheduledFor).toLocaleString()}</span>
                      <span
                        className={`flex-shrink-0 ${
                          status === 'sent' ? 'text-emerald-400' : status === 'pending' ? 'text-amber-400' : 'text-zinc-500'
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
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-white">Rental Agreement</h2>
              <div className="text-xs text-zinc-500 mt-0.5">
                {agreement.documentType === "NEGOTIATED" ? "Negotiated" : "Baseline"}
                {agreement.baselineVersion ? ` · v${agreement.baselineVersion}` : ""}
                {" · "}
                Updated {new Date(agreement.updatedAt).toLocaleString()}
              </div>
            </div>
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-medium ${
                agreement.status === "SIGNED_BASELINE" || agreement.status === "SIGNED_NEGOTIATED"
                  ? "bg-emerald-900/60 text-emerald-300"
                  : agreement.status === "NEGOTIATED_READY"
                  ? "bg-indigo-900/60 text-indigo-300"
                  : agreement.status === "REDLINE_UPLOADED" || agreement.status === "UNDER_REVIEW"
                  ? "bg-amber-900/60 text-amber-300"
                  : agreement.status === "DOWNLOAD_SENT"
                  ? "bg-blue-900/60 text-blue-300"
                  : "bg-zinc-700 text-zinc-300"
              }`}
            >
              {agreement.status.replace(/_/g, " ")}
            </span>
          </div>

          {(agreement.signedAt || agreement.signerName) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-zinc-950 border border-zinc-800 rounded-lg p-4">
              <div>
                <div className="text-zinc-500 text-xs">Signed at</div>
                <div className="text-white mt-0.5">
                  {agreement.signedAt ? new Date(agreement.signedAt).toLocaleString() : "—"}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 text-xs">Signer</div>
                <div className="text-white mt-0.5">{agreement.signerName || "—"}</div>
              </div>
              <div>
                <div className="text-zinc-500 text-xs">Title</div>
                <div className="text-white mt-0.5">{agreement.signerTitle || "—"}</div>
              </div>
              <div>
                <div className="text-zinc-500 text-xs">Email</div>
                <div className="text-white mt-0.5 break-all">{agreement.signerEmail || "—"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-zinc-500 text-xs">IP address</div>
                <div className="text-white mt-0.5">{agreement.signerIpAddress || "—"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-zinc-500 text-xs">User agent</div>
                <div className="text-white mt-0.5 text-xs break-all">{agreement.signerUserAgent || "—"}</div>
              </div>
              {agreement.acknowledgmentText && (
                <div className="col-span-full">
                  <div className="text-zinc-500 text-xs">Acknowledgment</div>
                  <div className="text-zinc-300 mt-0.5 text-xs leading-relaxed italic">
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
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-lg"
              >
                Open portal as client ↗
              </a>
            )}
            {agreement.documentToSignUrl && (
              <a
                href={agreement.documentToSignUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-lg"
              >
                Doc to sign
              </a>
            )}
            {agreement.wordDocumentUrl && (
              <a
                href={agreement.wordDocumentUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-lg"
              >
                Last .docx download
              </a>
            )}
            {agreement.redlineUploadUrl && (
              <a
                href={agreement.redlineUploadUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-lg"
              >
                Client redline
              </a>
            )}
            {agreement.signedDocumentUrl && (
              <a
                href={agreement.signedDocumentUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg"
              >
                Signed PDF
              </a>
            )}
            {agreement.contractReviewId && (
              <a
                href={`/tools/contract-review/${agreement.contractReviewId}`}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-lg"
              >
                Open contract review
              </a>
            )}
            <button
              onClick={resendPortalLink}
              disabled={agreementBusy}
              className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
            >
              Resend portal link
            </button>
          </div>

          {/* Manual override — recovery only. Signed states are intentionally absent. */}
          <div className="border-t border-zinc-800 pt-4 space-y-2">
            <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">
              Manual override
            </div>
            <div className="flex flex-wrap gap-2">
              {(["PORTAL_GENERATED", "DOWNLOAD_SENT", "REDLINE_UPLOADED", "UNDER_REVIEW", "NEGOTIATED_READY"] as const)
                .filter((s) => s !== agreement.status)
                .map((s) => (
                  <button
                    key={s}
                    onClick={() => overrideAgreementStatus(s)}
                    disabled={agreementBusy}
                    className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 text-zinc-300 text-xs font-semibold rounded"
                  >
                    → {s.replace(/_/g, " ")}
                  </button>
                ))}
            </div>
            <div className="text-[10px] text-zinc-600">
              Recovery only — SIGNED_BASELINE / SIGNED_NEGOTIATED are never settable here (signing event required).
            </div>
          </div>

          {agreementMsg && (
            <div className="text-xs text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-lg p-2">
              {agreementMsg}
            </div>
          )}
        </div>
      )}

      {/* Portal Access */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-white">Portal access</h2>
            <div className="text-xs text-zinc-500 mt-0.5">
              Per-contact magic links · 7-day TTL · 30-day session.{' '}
              <span className="text-zinc-600">Add new contacts via &ldquo;+ Add quote recipient&rdquo; above.</span>
            </div>
          </div>
        </div>

        {/* Active accesses */}
        {accesses === null ? (
          <div className="text-xs text-zinc-500">Loading…</div>
        ) : accesses.length === 0 ? (
          <div className="text-xs text-zinc-500">No portal access issued yet.</div>
        ) : (
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-zinc-950 text-zinc-500">
                <tr>
                  <th className="text-left p-2 font-semibold">Contact</th>
                  <th className="text-left p-2 font-semibold">Status</th>
                  <th className="text-left p-2 font-semibold">Last accessed</th>
                  <th className="text-right p-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {accesses.map((a) => {
                  const expired = new Date(a.magicLinkExpiresAt).getTime() < Date.now();
                  const status = a.revokedAt ? 'Revoked' : expired ? 'Expired' : a.accessCount > 0 ? 'Active' : 'Invited';
                  const statusColor = a.revokedAt
                    ? 'bg-zinc-700 text-zinc-400'
                    : expired
                    ? 'bg-amber-900/60 text-amber-300'
                    : a.accessCount > 0
                    ? 'bg-emerald-900/60 text-emerald-300'
                    : 'bg-blue-900/60 text-blue-300';
                  return (
                    <tr key={a.id}>
                      <td className="p-2">
                        <div className="text-white">{a.contact ? `${a.contact.firstName} ${a.contact.lastName}` : '—'}</div>
                        <div className="text-zinc-500 text-[10px]">{a.contact?.email || '—'}</div>
                      </td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${statusColor}`}>{status}</span>
                      </td>
                      <td className="p-2 text-zinc-500">
                        {a.lastAccessedAt ? new Date(a.lastAccessedAt).toLocaleString() : '—'}
                        {a.accessCount > 0 && <span className="text-zinc-600"> · {a.accessCount}x</span>}
                      </td>
                      <td className="p-2 text-right">
                        <div className="inline-flex gap-2">
                          {!a.revokedAt && (
                            <>
                              {a.contact && (
                                <button
                                  onClick={() => regenerateAccess(a.contact!.id)}
                                  className="text-zinc-400 hover:text-white text-[11px]"
                                >
                                  Regenerate
                                </button>
                              )}
                              <button
                                onClick={() => revokeAccess(a.id)}
                                className="text-red-400 hover:text-red-300 text-[11px]"
                              >
                                Revoke
                              </button>
                            </>
                          )}
                          {a.revokedAt && a.contact && (
                            <button
                              onClick={() => regenerateAccess(a.contact!.id)}
                              className="text-emerald-400 hover:text-emerald-300 text-[11px]"
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
          <div className="border-t border-zinc-800 pt-4">
            <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">
              New contact{detected.length === 1 ? '' : 's'} detected on this company&rsquo;s email threads
            </div>
            <div className="space-y-2">
              {detected.map((d) => (
                <div key={d.email} className="flex items-center justify-between gap-3 bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-white text-sm truncate">{d.displayName}</div>
                    <div className="text-zinc-500 text-[10px] truncate">
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
                    className="px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-[11px] font-semibold rounded"
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
          <div className="border-t border-zinc-800 pt-3 text-[11px] text-zinc-400">{inviteMsg}</div>
        )}
      </div>

      {/* Line Items */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-6">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Line Items</h2>
          {isEditable && (
            <button onClick={() => { setShowAddForm(!showAddForm); if (!showAddForm) resetForm(); }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
              {showAddForm ? "Cancel" : "+ Add Item"}
            </button>
          )}
        </div>

        {showAddForm && isEditable && (
          <div className="px-6 py-4 bg-zinc-800/50 border-b border-zinc-800 space-y-4">
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">Type</label>
                <select value={liType} onChange={(e) => { setLiType(e.target.value); setLiDesc(""); setLiAssetCatId(""); setLiInvItemId(""); setInvSearch(""); }}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500">
                  {LINE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-5">
                <label className="block text-xs text-zinc-500 mb-1">
                  {liType === "VEHICLE" ? "Vehicle" : liType === "EQUIPMENT" || liType === "EXPENDABLE" ? "Search Inventory" : "Description"}
                </label>
                {liType === "VEHICLE" ? (
                  <select value={liAssetCatId} onChange={(e) => { const cat = assetCats.find((c) => c.id === e.target.value); if (cat) selectAssetCategory(cat); }}
                    className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500">
                    <option value="">Select vehicle...</option>
                    {assetCats.map((c) => <option key={c.id} value={c.id}>{c.name} ({fmt(c.dailyRate)}/day)</option>)}
                  </select>
                ) : liType === "EQUIPMENT" || liType === "EXPENDABLE" ? (
                  <div className="relative">
                    <input type="text" value={invSearch} onChange={(e) => setInvSearch(e.target.value)}
                      onFocus={() => invResults.length > 0 && setShowInvDropdown(true)}
                      placeholder="Type to search inventory..."
                      className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
                    {showInvDropdown && invResults.length > 0 && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-[200px] overflow-y-auto">
                        {invResults.map((item) => (
                          <button key={item.id} onClick={() => selectInventoryItem(item)}
                            className="w-full px-3 py-2 text-left hover:bg-zinc-700 text-sm text-white flex justify-between">
                            <span className="font-mono">{item.code}</span>
                            <span className="text-zinc-400 text-xs">{item.category.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <input type="text" value={liDesc} onChange={(e) => setLiDesc(e.target.value)} placeholder="e.g. Day Player Grip, Delivery Fee..."
                    className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
                )}
              </div>
              <div className="col-span-5">
                <label className="block text-xs text-zinc-500 mb-1">Description (on invoice)</label>
                <input type="text" value={liDesc} onChange={(e) => setLiDesc(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
              </div>
            </div>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">Start</label>
                <input type="date" value={liStartDate} onChange={(e) => setLiStartDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">End</label>
                <input type="date" value={liEndDate} onChange={(e) => setLiEndDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">Rate Type</label>
                <select value={liRateType} onChange={(e) => setLiRateType(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500">
                  <option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="FLAT">Flat</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">Rate ($)</label>
                <input type="number" step="0.01" value={liRate} onChange={(e) => setLiRate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="col-span-1">
                <label className="block text-xs text-zinc-500 mb-1">Qty</label>
                <input type="number" min="1" value={liQty} onChange={(e) => setLiQty(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="col-span-3 flex items-end gap-2">
                <button onClick={addLineItem} disabled={!liDesc || !liRate || adding}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded transition-colors">
                  {adding ? "Adding..." : "Add"}
                </button>
                <button onClick={() => setShowAddForm(false)} className="px-3 py-1.5 text-zinc-400 hover:text-white text-sm transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-left text-xs uppercase tracking-wide">
              <th className="px-6 py-2.5 font-medium w-[80px]">Type</th>
              <th className="px-4 py-2.5 font-medium">Description</th>
              <th className="px-4 py-2.5 font-medium">Dates</th>
              <th className="px-4 py-2.5 font-medium">Rate</th>
              <th className="px-4 py-2.5 font-medium text-center">Qty</th>
              <th className="px-4 py-2.5 font-medium text-center">Days</th>
              <th className="px-4 py-2.5 font-medium text-right">Total</th>
              {isEditable && <th className="px-4 py-2.5 font-medium w-[40px]"></th>}
            </tr>
          </thead>
          <tbody>
            {order.lineItems.length === 0 ? (
              <tr><td colSpan={isEditable ? 8 : 7} className="px-6 py-8 text-center text-zinc-500">
                No line items yet. Click \"+ Add Item\" to start building this order.
              </td></tr>
            ) : (
              order.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-6 py-3">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      li.type === "VEHICLE" ? "bg-blue-900/40 text-blue-300" :
                      li.type === "DISCOUNT" ? "bg-red-900/40 text-red-300" :
                      li.type === "FEE" ? "bg-amber-900/40 text-amber-300" :
                      "bg-zinc-700 text-zinc-300"
                    }`}>{li.type}</span>
                  </td>
                  <td className="px-4 py-3 text-white">{li.description}</td>
                  <td className="px-4 py-3 text-zinc-400 whitespace-nowrap text-xs">
                    {li.startDate ? `${fmtDate(li.startDate)} - ${fmtDate(li.endDate)}` : "--"}
                  </td>
                  {editingLineId === li.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input type="number" step="0.01" value={editRate} onChange={(e) => setEditRate(e.target.value)}
                          className="w-24 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-white text-right font-mono" />
                        <span className="text-zinc-500 text-xs ml-1">/{li.rateType === "FLAT" ? "flat" : li.rateType === "WEEKLY" ? "wk" : "day"}</span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="number" value={editQty} onChange={(e) => setEditQty(e.target.value)}
                          className="w-14 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-white text-center" />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="number" step="0.5" value={editDays} onChange={(e) => setEditDays(e.target.value)}
                          placeholder="auto"
                          className="w-14 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-white text-center" />
                      </td>
                      <td className="px-4 py-3 text-right text-white font-mono">{fmt(li.lineTotal)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <button onClick={() => saveEditLine(li.id)} className="text-emerald-400 hover:text-emerald-300 text-xs mr-2">Save</button>
                        <button onClick={() => setEditingLineId(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">X</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                        {fmt(li.rate)}<span className="text-zinc-500 text-xs">/{li.rateType === "FLAT" ? "flat" : li.rateType === "WEEKLY" ? "wk" : "day"}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-300">{li.quantity}</td>
                      <td className="px-4 py-3 text-center text-zinc-400">{li.days ?? "--"}</td>
                      <td className="px-4 py-3 text-right text-white font-mono">{fmt(li.lineTotal)}</td>
                      {isEditable && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button onClick={() => startEditLine(li)} className="text-zinc-500 hover:text-blue-400 text-xs mr-2">Edit</button>
                          <button onClick={() => deleteLineItem(li.id)} className="text-zinc-500 hover:text-red-400 transition-colors" title="Remove">&times;</button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {order.lineItems.length > 0 && (
          <div className="px-6 py-4 border-t border-zinc-800 flex justify-end">
            <div className="w-[280px] space-y-1.5 text-sm">
              <div className="flex justify-between text-zinc-400">
                <span>Subtotal</span><span className="font-mono text-zinc-300">{fmt(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Tax ({(Number(order.taxRate) * 100).toFixed(1)}%)</span><span className="font-mono text-zinc-300">{fmt(order.taxAmount)}</span>
              </div>
              <div className="flex justify-between text-white font-semibold pt-1.5 border-t border-zinc-700">
                <span>Total</span><span className="font-mono">{fmt(order.total)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Notes</h2>
        <p className="text-zinc-400 text-sm whitespace-pre-wrap">{order.notes || "No notes."}</p>
        <p className="text-xs text-zinc-600 mt-4">
          Created {new Date(order.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {sendQuoteOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !sendQuoteBusy && closeSendQuote()}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Send quote</h2>
              <button
                onClick={closeSendQuote}
                disabled={sendQuoteBusy}
                className="text-zinc-400 hover:text-white text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {sendQuoteResult?.ok ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-emerald-700 bg-emerald-900/30 text-emerald-100 text-sm px-3 py-2.5">
                  Quote {order.orderNumber} emailed to{' '}
                  <span className="font-semibold">{sendQuoteResult.recipient.name}</span> &lt;{sendQuoteResult.recipient.email}&gt;
                  {sendQuoteResult.cc.length > 0 && (
                    <> with CC to {sendQuoteResult.cc.map((c) => c.email).join(', ')}</>
                  )}
                  .
                </div>
                <button
                  onClick={closeSendQuote}
                  className="w-full px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold rounded-lg"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm space-y-1.5 mb-4">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">To</div>
                  {recipients.primary ? (
                    <div className="text-zinc-100">
                      {recipients.primary.name}{' '}
                      <span className="text-zinc-500">&lt;{recipients.primary.email}&gt;</span>
                      {recipients.primary.role && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-500">
                          {recipients.primary.role}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-rose-300">No recipient — add a contact to the job first.</div>
                  )}
                  {recipients.others.length > 0 && (
                    <>
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-2">CC</div>
                      {recipients.others.map((r) => (
                        <div key={r.id} className="text-zinc-300 text-xs">
                          {r.name}{' '}
                          <span className="text-zinc-500">&lt;{r.email}&gt;</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <div className="mb-4">
                  <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1.5 font-semibold">
                    Note (optional)
                  </label>
                  <textarea
                    value={sendQuoteMessage}
                    onChange={(e) => setSendQuoteMessage(e.target.value)}
                    rows={4}
                    maxLength={5000}
                    placeholder="Anything you want to add above the standard quote-attached body…"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 resize-y"
                  />
                </div>

                <div className="text-xs text-zinc-500 mb-4">
                  Quote PDF {order.orderNumber}.pdf attached.{' '}
                  {order.status === 'DRAFT'
                    ? 'After sending, the order will move to QUOTE_SENT.'
                    : 'Resend — the order is already QUOTE_SENT; the original timestamp will not change.'}
                </div>

                {sendQuoteResult && !sendQuoteResult.ok && (
                  <div className="rounded-lg border border-rose-700 bg-rose-900/30 text-rose-200 text-sm px-3 py-2 mb-4">
                    {sendQuoteResult.error}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={closeSendQuote}
                    disabled={sendQuoteBusy}
                    className="px-3 py-2 text-zinc-400 hover:text-white text-sm disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={sendQuote}
                    disabled={sendQuoteBusy || !recipients.primary || !order.quotePdfUrl}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg"
                  >
                    {sendQuoteBusy ? 'Sending…' : 'Send quote'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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
          className="text-[11px] text-amber-400 hover:text-amber-300 underline decoration-dotted underline-offset-2"
        >
          + Add quote recipient
        </button>
      );
    }
    return (
      <div className="text-[11px] text-amber-400">
        ⚠ No recipient — add a contact to send
      </div>
    );
  }
  const others = recipients.others;
  const tooltip = others.length
    ? others.map((o) => `${o.name} <${o.email}>${o.role ? ` · ${o.role}` : ''}`).join('\n')
    : undefined;
  return (
    <div className="text-[11px] text-zinc-500 leading-tight">
      <span className="text-zinc-600">→ </span>
      <a
        href={`/crm/people/${recipients.primary.id}`}
        className="text-zinc-300 hover:text-white underline decoration-dotted underline-offset-2"
        title="Open contact"
      >
        {recipients.primary.email}
      </a>
      {others.length > 0 && (
        <span className="text-zinc-500 cursor-help" title={tooltip}>
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
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-3">
      <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Add quote recipient</div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <input
          value={email}
          onChange={(e) => onChange.email(e.target.value)}
          placeholder="email@example.com"
          type="email"
          autoFocus
          className="sm:col-span-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <input
          value={first}
          onChange={(e) => onChange.first(e.target.value)}
          placeholder="First name"
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <input
          value={last}
          onChange={(e) => onChange.last(e.target.value)}
          placeholder="Last name"
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Role
          <select
            value={role}
            onChange={(e) => onChange.role(e.target.value as typeof role)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-zinc-600"
          >
            <option value="PRODUCER">Producer</option>
            <option value="PM">PM</option>
            <option value="PC">PC</option>
            <option value="ACCOUNTING">Accounting</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={grantPortal}
            onChange={(e) => onChange.grantPortal(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          Also grant portal access (sends magic link)
        </label>
      </div>
      {err && <div className="text-[11px] text-red-400">{err}</div>}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-zinc-400 hover:text-zinc-200 disabled:opacity-50 text-sm"
        >
          Cancel
        </button>
        {hasQuotePdf ? (
          <button
            onClick={() => onSubmit(true)}
            disabled={busy || !email.trim()}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
          >
            {busy ? "Adding…" : "Add and Send Quote"}
          </button>
        ) : (
          <button
            onClick={() => onSubmit(false)}
            disabled={busy || !email.trim()}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        )}
      </div>
    </div>
  );
}
