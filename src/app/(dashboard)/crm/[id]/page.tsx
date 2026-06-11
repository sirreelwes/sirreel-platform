"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { OutreachQuickLogModal } from "@/components/crm/OutreachQuickLogModal";

type Activity = {
  id: string; type: string; subject: string | null; body: string;
  dueDate: string | null; completed: boolean; createdAt: string;
  agent: { id: string; name: string };
};

type OutreachActivityRow = {
  id: string;
  type: 'VISIT' | 'CALL' | 'EMAIL' | 'TEXT' | 'EVENT' | 'DROP_IN';
  notes: string;
  occurredAt: string;
  followUpAt: string | null;
  followUpDone: boolean;
  createdBy: { id: string; name: string };
  person: { id: string; firstName: string; lastName: string } | null;
};

// Server-derived (timeline-merge feature). Outbound emails matched
// to this company via affiliated-person email / thread / companyId.
type OutboundEmail = {
  id: string;
  subject: string;
  snippet: string | null;
  sentAt: string;
  fromAddress: string;
  toAddresses: string[];
  threadId: string | null;
};

function fromHeaderDisplay(header: string): string {
  const m = header.match(/^(.+?)\s*<[^>]+>\s*$/);
  if (m && m[1]) return m[1].replace(/^['"]|['"]$/g, '').trim();
  return header.trim();
}

type DiscountTendency = 'NONE' | 'OCCASIONAL' | 'FREQUENT' | 'ALWAYS';

type CompanyDetail = {
  id: string; name: string; tier: string; totalSpend: string; totalBookings: number;
  website: string | null; billingEmail: string | null; industry: string;
  coiOnFile: boolean; coiExpiry: string | null; notes: string | null;
  // Discount / negotiation profile — added in 859ca8e. Drives the
  // "Negotiates" chip in the header + the next pass's CRM-list badge.
  discountTendency: DiscountTendency;
  typicalDiscountPct: number | null;
  discountNotes: string | null;
  // Negotiated standing agreement — Path A from the contract-review
  // discovery report. When set, future orders auto-present this PDF
  // instead of the baseline (wired in step b).
  negotiatedTermsUrl: string | null;
  negotiatedTermsSummary: string | null;
  negotiatedTermsNegotiatedAt: string | null;
  negotiatedTermsApprovedBy: string | null;
  negotiatedTermsApprovedAt: string | null;
  negotiatedTermsActiveAsOf: string | null;
  negotiatedTermsReviewDueDate: string | null;
  affiliations: { id: string; productionName: string | null; isCurrent: boolean; roleOnShow: string | null;
    person: { id: string; firstName: string; lastName: string; email: string; phone: string | null; role: string } }[];
  orders: { id: string; orderNumber: string; status: string; total: string; description: string | null; startDate: string | null; createdAt: string }[];
  activities: Activity[];
  outreachActivities: OutreachActivityRow[];
  outboundEmails: OutboundEmail[];
};

const TENDENCY_LABEL: Record<DiscountTendency, string> = {
  NONE: 'Doesn\u2019t negotiate',
  OCCASIONAL: 'Occasionally negotiates',
  FREQUENT: 'Frequently negotiates',
  ALWAYS: 'Always negotiates',
};

// Tone hints for the read-only Negotiates chip in the header. NONE
// is suppressed entirely (chip doesn't render). OCCASIONAL stays
// neutral. FREQUENT and ALWAYS escalate to warn so the agent sees
// the negotiation pattern at a glance when opening the file.
const TENDENCY_TONE: Record<DiscountTendency, string> = {
  NONE: 'bg-chip-neutral-bg text-chip-neutral-fg',
  OCCASIONAL: 'bg-chip-neutral-bg text-chip-neutral-fg',
  FREQUENT: 'bg-chip-warn-bg text-chip-warn-fg',
  ALWAYS: 'bg-chip-warn-bg text-chip-warn-fg',
};

const TIER_STYLES: Record<string, string> = {
  VIP: "bg-chip-warn-bg text-chip-warn-fg", PREFERRED: "bg-cadence-booked-bg text-cadence-booked-fg",
  STANDARD: "bg-chip-neutral-bg text-chip-neutral-fg", NEW: "bg-chip-good-bg text-chip-good-fg",
};

const fmt = (n: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "--";

export default function CompanyDetailPage() {
  const router = useRouter();
  const params = useParams();
  const companyId = params.id as string;
  const { data: session } = useSession();

  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Activity form
  const [actType, setActType] = useState("NOTE");
  const [actSubject, setActSubject] = useState("");
  const [actBody, setActBody] = useState("");
  const [actDueDate, setActDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Link contact modal
  const [showLinkContact, setShowLinkContact] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<Array<{id: string; firstName: string; lastName: string; email: string; role: string}>>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [linkProduction, setLinkProduction] = useState("");
  const [linkRole, setLinkRole] = useState("");
  const [linkIsCurrent, setLinkIsCurrent] = useState(true);

  const fetchCompany = useCallback(async () => {
    const res = await fetch(`/api/crm/companies/${companyId}`);
    if (!res.ok) { router.push("/crm"); return; }
    setCompany(await res.json());
    setLoading(false);
  }, [companyId, router]);

  useEffect(() => { fetchCompany(); }, [fetchCompany]);

  // Edit mode — collapsed by default; an Edit button on the header
  // expands the form. Same pattern as the Person detail page. Form
  // covers the editable Company columns the PUT route accepts; the
  // Discount profile group hangs off the bottom.
  const [editing, setEditing] = useState(false);
  // Quick-log outreach modal (pre-linked to this company).
  const [showLogOutreach, setShowLogOutreach] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    website: string;
    billingEmail: string;
    tier: string;
    coiOnFile: boolean;
    coiExpiry: string;
    notes: string;
    discountTendency: DiscountTendency;
    typicalDiscountPct: string;
    discountNotes: string;
  } | null>(null);

  // Seed the form from the loaded Company once it lands.
  useEffect(() => {
    if (!company) return;
    setEditForm({
      name: company.name,
      website: company.website ?? '',
      billingEmail: company.billingEmail ?? '',
      tier: company.tier,
      coiOnFile: company.coiOnFile,
      coiExpiry: company.coiExpiry ? company.coiExpiry.slice(0, 10) : '',
      notes: company.notes ?? '',
      discountTendency: company.discountTendency,
      typicalDiscountPct: company.typicalDiscountPct == null ? '' : String(company.typicalDiscountPct),
      discountNotes: company.discountNotes ?? '',
    });
  }, [company]);

  // Standing-agreement form. Owned separately from the main edit
  // form because file upload + multipart POST has a different
  // shape than the JSON PUT used for the rest of the Company row.
  // Visible inside the same edit panel; has its own Save button.
  const [saFile, setSaFile] = useState<File | null>(null);
  const [saSummary, setSaSummary] = useState('');
  const [saApprovedBy, setSaApprovedBy] = useState('');
  const [saNegotiatedAt, setSaNegotiatedAt] = useState('');
  const [saApprovedAt, setSaApprovedAt] = useState('');
  const [saActiveAsOf, setSaActiveAsOf] = useState('');
  const [saReviewDueDate, setSaReviewDueDate] = useState('');
  const [savingStanding, setSavingStanding] = useState(false);
  const [standingMsg, setStandingMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!company) return;
    setSaSummary(company.negotiatedTermsSummary ?? '');
    setSaApprovedBy(company.negotiatedTermsApprovedBy ?? '');
    setSaNegotiatedAt(company.negotiatedTermsNegotiatedAt ? company.negotiatedTermsNegotiatedAt.slice(0, 10) : '');
    setSaApprovedAt(company.negotiatedTermsApprovedAt ? company.negotiatedTermsApprovedAt.slice(0, 10) : '');
    setSaActiveAsOf(company.negotiatedTermsActiveAsOf ? company.negotiatedTermsActiveAsOf.slice(0, 10) : '');
    setSaReviewDueDate(company.negotiatedTermsReviewDueDate ? company.negotiatedTermsReviewDueDate.slice(0, 10) : '');
    setSaFile(null);
  }, [company]);

  const saveStandingAgreement = useCallback(async () => {
    setSavingStanding(true);
    setStandingMsg(null);
    try {
      const fd = new FormData();
      if (saFile) fd.append('file', saFile);
      fd.append('summary', saSummary);
      fd.append('approvedBy', saApprovedBy);
      fd.append('negotiatedAt', saNegotiatedAt);
      fd.append('approvedAt', saApprovedAt);
      fd.append('activeAsOf', saActiveAsOf);
      fd.append('reviewDueDate', saReviewDueDate);
      const res = await fetch(`/api/crm/companies/${companyId}/standing-agreement`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStandingMsg(data.error || 'Save failed');
        return;
      }
      await fetchCompany();
      setStandingMsg('Saved.');
    } finally {
      setSavingStanding(false);
    }
  }, [companyId, saFile, saSummary, saApprovedBy, saNegotiatedAt, saApprovedAt, saActiveAsOf, saReviewDueDate, fetchCompany]);

  const clearStandingAgreement = useCallback(async () => {
    if (!confirm('Clear the standing agreement on this company? The PDF stays in storage for audit; future orders revert to the baseline template.')) return;
    setSavingStanding(true);
    setStandingMsg(null);
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/standing-agreement`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStandingMsg(data.error || 'Clear failed');
        return;
      }
      await fetchCompany();
      setStandingMsg('Cleared.');
    } finally {
      setSavingStanding(false);
    }
  }, [companyId, fetchCompany]);

  const saveCompany = useCallback(async () => {
    if (!editForm) return;
    setSavingCompany(true);
    try {
      const res = await fetch(`/api/crm/companies/${companyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          website: editForm.website || null,
          billingEmail: editForm.billingEmail || null,
          tier: editForm.tier,
          coiOnFile: editForm.coiOnFile,
          coiExpiry: editForm.coiExpiry || null,
          notes: editForm.notes || null,
          discountTendency: editForm.discountTendency,
          typicalDiscountPct: editForm.typicalDiscountPct || null,
          discountNotes: editForm.discountNotes || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Save failed');
        return;
      }
      await fetchCompany();
      setEditing(false);
    } finally {
      setSavingCompany(false);
    }
  }, [editForm, companyId, fetchCompany]);

  const addActivity = async () => {
    if (!actBody) return;
    setSaving(true);
    const userId = (session?.user as any)?.id;
    await fetch("/api/crm/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        agentId: userId,
        type: actType,
        subject: actSubject || null,
        body: actBody,
        dueDate: actDueDate || null,
      }),
    });
    setActSubject(""); setActBody(""); setActDueDate(""); setSaving(false);
    fetchCompany();
  };

  const searchContacts = async (q: string) => {
    setContactSearch(q);
    if (!q || q.length < 2) { setContactResults([]); return; }
    const res = await fetch(`/api/crm/people?search=${encodeURIComponent(q)}`);
    const data = await res.json();
    setContactResults(data.people?.slice(0, 8) || []);
  };

  const linkContact = async () => {
    if (!selectedContactId) return;
    await fetch("/api/crm/affiliations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId: selectedContactId,
        companyId,
        productionName: linkProduction || null,
        roleOnShow: linkRole || null,
        isCurrent: linkIsCurrent,
      }),
    });
    setShowLinkContact(false);
    setContactSearch(""); setContactResults([]); setSelectedContactId("");
    setLinkProduction(""); setLinkRole(""); setLinkIsCurrent(true);
    fetchCompany();
  };

  const removeAffiliation = async (id: string) => {
    if (!confirm("Remove this contact from the company?")) return;
    await fetch(`/api/crm/affiliations/${id}`, { method: "DELETE" });
    fetchCompany();
  };

  const completeActivity = async (id: string) => {
    await fetch(`/api/crm/activities/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    fetchCompany();
  };

  if (loading || !company) {
    return <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)] flex items-center justify-center"><p className="text-lt-fg3">Loading...</p></div>;
  }

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1200px] mx-auto">
      <button onClick={() => router.push("/crm")} className="text-sm text-lt-fg2 hover:text-lt-fg mb-4 inline-block">&larr; Back to Clients</button>

      {/* Header */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 mb-6">
        {editing && editForm ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-lt-fg3 mb-1">Company name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                />
              </div>
              <div>
                <label className="block text-xs text-lt-fg3 mb-1">Tier</label>
                <select
                  value={editForm.tier}
                  onChange={(e) => setEditForm({ ...editForm, tier: e.target.value })}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                >
                  <option value="NEW">New</option>
                  <option value="STANDARD">Standard</option>
                  <option value="PREFERRED">Preferred</option>
                  <option value="VIP">VIP</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-lt-fg3 mb-1">Website</label>
                <input
                  type="text"
                  value={editForm.website}
                  onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                />
              </div>
              <div>
                <label className="block text-xs text-lt-fg3 mb-1">Billing email</label>
                <input
                  type="email"
                  value={editForm.billingEmail}
                  onChange={(e) => setEditForm({ ...editForm, billingEmail: e.target.value })}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm text-lt-fg pt-5">
                <input
                  type="checkbox"
                  checked={editForm.coiOnFile}
                  onChange={(e) => setEditForm({ ...editForm, coiOnFile: e.target.checked })}
                  className="accent-lt-fg"
                />
                COI on file
              </label>
              <div>
                <label className="block text-xs text-lt-fg3 mb-1">COI expiry</label>
                <input
                  type="date"
                  value={editForm.coiExpiry}
                  onChange={(e) => setEditForm({ ...editForm, coiExpiry: e.target.value })}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-lt-fg3 mb-1">Notes</label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg resize-y"
              />
            </div>

            {/* Negotiation & discounts — institutional memory for
                rate-talks. Tendency drives the in-header chip + the
                CRM-list Negotiates badge (next pass). */}
            <div className="border-t border-lt-hairline pt-4 space-y-3">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
                Negotiation & discounts
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-lt-fg3 mb-1">Tendency</label>
                  <select
                    value={editForm.discountTendency}
                    onChange={(e) => setEditForm({ ...editForm, discountTendency: e.target.value as DiscountTendency })}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                  >
                    <option value="NONE">Doesn&rsquo;t negotiate</option>
                    <option value="OCCASIONAL">Occasionally negotiates</option>
                    <option value="FREQUENT">Frequently negotiates</option>
                    <option value="ALWAYS">Always negotiates</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-lt-fg3 mb-1">Typical discount (%)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    value={editForm.typicalDiscountPct}
                    onChange={(e) => setEditForm({ ...editForm, typicalDiscountPct: e.target.value })}
                    placeholder="e.g. 15"
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-lt-fg3 mb-1">Discount notes</label>
                <textarea
                  value={editForm.discountNotes}
                  onChange={(e) => setEditForm({ ...editForm, discountNotes: e.target.value })}
                  rows={2}
                  placeholder="Context — e.g. always asks for free delivery, never pays rush surcharge."
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg resize-y"
                />
              </div>
            </div>

            {/* Negotiated standing agreement — separate save path
                (multipart) because the PDF upload doesn't fit into
                the JSON PUT used by the rest of the form. Its own
                Save button keeps the data flow clean; the agent
                explicitly commits one or the other. */}
            <div className="border-t border-lt-hairline pt-4 space-y-3">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
                  Negotiated standing agreement
                </div>
                {company.negotiatedTermsApprovedAt && (
                  <button
                    type="button"
                    onClick={clearStandingAgreement}
                    disabled={savingStanding}
                    className="text-[11px] text-chip-bad-fg hover:opacity-70 disabled:opacity-40"
                  >
                    Clear standing agreement
                  </button>
                )}
              </div>
              <p className="text-[11px] text-lt-fg3">
                Upload the negotiated PDF and the dates that bound it. When set, future orders for this client auto-present this PDF instead of the standard baseline.
              </p>
              <div>
                <label className="block text-xs text-lt-fg3 mb-1">
                  PDF {company.negotiatedTermsUrl ? '(replace existing)' : '(required for first record)'}
                </label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setSaFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-lt-fg2 file:mr-4 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-lt-inner file:text-lt-fg file:cursor-pointer hover:file:bg-lt-hairline"
                />
                {company.negotiatedTermsUrl && (
                  <a
                    href={company.negotiatedTermsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-lt-fg hover:text-black mt-1 inline-block"
                  >
                    Current PDF on file ↗
                  </a>
                )}
              </div>
              <div>
                <label className="block text-xs text-lt-fg3 mb-1">Summary (plain-English diff)</label>
                <textarea
                  value={saSummary}
                  onChange={(e) => setSaSummary(e.target.value)}
                  rows={3}
                  placeholder="What was negotiated — e.g. liability cap lowered to insured value; missing-equipment return window extended to 30 days; admin fee waived. If this came from a Contract Review, paste the review id or link here for the audit trail."
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg resize-y"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-lt-fg3 mb-1">Negotiated on</label>
                  <input
                    type="date"
                    value={saNegotiatedAt}
                    onChange={(e) => setSaNegotiatedAt(e.target.value)}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-lt-fg3 mb-1">Approved by</label>
                  <input
                    type="text"
                    value={saApprovedBy}
                    onChange={(e) => setSaApprovedBy(e.target.value)}
                    placeholder="Name or email"
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-lt-fg3 mb-1">Approved on</label>
                  <input
                    type="date"
                    value={saApprovedAt}
                    onChange={(e) => setSaApprovedAt(e.target.value)}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-lt-fg3 mb-1">Active as of</label>
                  <input
                    type="date"
                    value={saActiveAsOf}
                    onChange={(e) => setSaActiveAsOf(e.target.value)}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-lt-fg3 mb-1">Review due</label>
                  <input
                    type="date"
                    value={saReviewDueDate}
                    onChange={(e) => setSaReviewDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveStandingAgreement}
                  disabled={savingStanding}
                  className="px-3 py-2 bg-lt-fg hover:bg-black text-white text-xs font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingStanding ? 'Saving…' : 'Save standing agreement'}
                </button>
                {standingMsg && (
                  <span className={`text-[11px] ${standingMsg === 'Saved.' || standingMsg === 'Cleared.' ? 'text-chip-good-fg' : 'text-chip-bad-fg'}`}>
                    {standingMsg}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={saveCompany}
                disabled={savingCompany}
                className="px-4 py-2 bg-lt-fg hover:bg-black text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {savingCompany ? 'Saving\u2026' : 'Save'}
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={savingCompany}
                className="px-4 py-2 text-lt-fg2 hover:text-lt-fg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <h1 className="text-2xl font-semibold text-lt-fg">{company.name}</h1>
                  <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${TIER_STYLES[company.tier]}`}>{company.tier}</span>
                  {/* Negotiates chip — only when the agent has set a
                      non-NONE tendency or recorded a typical %. Tone
                      escalates with frequency (warn for FREQUENT/ALWAYS). */}
                  {(company.discountTendency !== 'NONE' || company.typicalDiscountPct != null) && (
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${TENDENCY_TONE[company.discountTendency]}`}
                      title={company.discountNotes ?? undefined}
                    >
                      Negotiates · {TENDENCY_LABEL[company.discountTendency].replace(/^[A-Z]/, (c) => c.toLowerCase())}
                      {company.typicalDiscountPct != null && ` · ~${company.typicalDiscountPct}%`}
                    </span>
                  )}
                </div>
                <p className="text-lt-fg2 text-sm">{company.industry.replace(/_/g, ' ')}</p>
              </div>
              <div className="text-right flex flex-col items-end gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowLogOutreach(true)}
                    className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-2 py-1 rounded"
                  >
                    + Log outreach
                  </button>
                  <button
                    onClick={() => setEditing(true)}
                    className="text-xs text-lt-fg hover:text-black"
                  >
                    Edit
                  </button>
                </div>
                <p className="text-2xl font-semibold text-lt-fg font-mono">{fmt(company.totalSpend)}</p>
                <p className="text-sm text-lt-fg2">{company.totalBookings} bookings | {company.orders.length} orders</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
              <div><span className="text-lt-fg3">Website</span><p className="text-lt-fg mt-0.5">{company.website || '--'}</p></div>
              <div><span className="text-lt-fg3">Billing Email</span><p className="text-lt-fg mt-0.5">{company.billingEmail || '--'}</p></div>
              <div><span className="text-lt-fg3">COI</span><p className="text-lt-fg mt-0.5">{company.coiOnFile ? `On file (exp ${fmtDate(company.coiExpiry)})` : 'Missing'}</p></div>
              <div><span className="text-lt-fg3">Notes</span><p className="text-lt-fg2 mt-0.5 text-xs">{company.notes || '--'}</p></div>
            </div>
            {/* Discount profile — read-only mirror of the form group.
                Renders only when the agent has filled anything in. */}
            {(company.discountTendency !== 'NONE' || company.typicalDiscountPct != null || company.discountNotes) && (
              <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-lt-hairline text-sm">
                <div>
                  <span className="text-lt-fg3">Negotiation tendency</span>
                  <p className="text-lt-fg mt-0.5">{TENDENCY_LABEL[company.discountTendency]}</p>
                </div>
                <div>
                  <span className="text-lt-fg3">Typical discount</span>
                  <p className="text-lt-fg mt-0.5">{company.typicalDiscountPct != null ? `~${company.typicalDiscountPct}%` : '--'}</p>
                </div>
                <div>
                  <span className="text-lt-fg3">Discount notes</span>
                  <p className="text-lt-fg2 mt-0.5 text-xs whitespace-pre-wrap">{company.discountNotes || '--'}</p>
                </div>
              </div>
            )}

            {/* Negotiated standing agreement — read-only block.
                Renders only when the agreement has been approved
                (approvedAt is the canonical "this is active" flag).
                Includes a soft past-review hint when the review-due
                date has passed; future orders still auto-present the
                PDF — past-review never blocks. */}
            {company.negotiatedTermsApprovedAt && (() => {
              const reviewDue = company.negotiatedTermsReviewDueDate
                ? new Date(company.negotiatedTermsReviewDueDate)
                : null;
              const pastReview = reviewDue ? reviewDue.getTime() < Date.now() : false;
              return (
                <div className="mt-4 pt-4 border-t border-lt-hairline">
                  <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-chip-warn-fg bg-chip-warn-bg px-2 py-0.5 rounded">
                        Standing agreement on file
                      </span>
                      {pastReview && (
                        <span
                          className="text-[10px] uppercase tracking-wider font-semibold text-chip-bad-fg bg-chip-bad-bg px-2 py-0.5 rounded"
                          title="Review-due date has passed. Future orders still use this PDF; consider re-papering."
                        >
                          Past review · re-paper soon
                        </span>
                      )}
                    </div>
                    {company.negotiatedTermsUrl && (
                      <a
                        href={company.negotiatedTermsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-lt-fg hover:text-black"
                      >
                        Open PDF ↗
                      </a>
                    )}
                  </div>
                  {company.negotiatedTermsSummary && (
                    <p className="text-xs text-lt-fg2 whitespace-pre-wrap mb-2">{company.negotiatedTermsSummary}</p>
                  )}
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-lt-fg3">Negotiated</span>
                      <p className="text-lt-fg mt-0.5">{fmtDate(company.negotiatedTermsNegotiatedAt)}</p>
                    </div>
                    <div>
                      <span className="text-lt-fg3">Approved</span>
                      <p className="text-lt-fg mt-0.5">
                        {fmtDate(company.negotiatedTermsApprovedAt)}
                        {company.negotiatedTermsApprovedBy && (
                          <span className="text-lt-fg3"> · by {company.negotiatedTermsApprovedBy}</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <span className="text-lt-fg3">Active as of</span>
                      <p className="text-lt-fg mt-0.5">{fmtDate(company.negotiatedTermsActiveAsOf)}</p>
                    </div>
                    <div>
                      <span className="text-lt-fg3">Review due</span>
                      <p className={`mt-0.5 ${pastReview ? 'text-chip-bad-fg' : 'text-lt-fg'}`}>
                        {fmtDate(company.negotiatedTermsReviewDueDate)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Contacts + Orders */}
        <div className="col-span-2 space-y-6">
          {/* Contacts + Affiliations */}
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-lt-fg">Contacts on Shows</h2>
              <button onClick={() => setShowLinkContact(true)}
                className="text-xs text-lt-fg hover:text-black font-medium">+ Link Contact</button>
            </div>
            {company.affiliations.length === 0 ? (
              <p className="text-lt-fg3 text-sm">No contacts linked. Add a freelancer who worked on a production with this company.</p>
            ) : (
              <div className="space-y-2">
                {company.affiliations.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-2 border-b border-lt-hairline/50 last:border-0 group">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-lt-fg font-medium">{a.person.firstName} {a.person.lastName}</p>
                        {a.isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-chip-good-bg text-chip-good-fg">Current</span>}
                      </div>
                      <p className="text-xs text-lt-fg2">
                        {a.productionName ? <span className="text-lt-fg2">{a.productionName}</span> : ""}
                        {a.productionName && a.roleOnShow ? " | " : ""}
                        {a.roleOnShow ? a.roleOnShow.replace(/_/g, " ") : (a.productionName ? "" : a.person.role.replace(/_/g, " "))}
                      </p>
                    </div>
                    <div className="text-right text-xs text-lt-fg2 mr-3">
                      <p>{a.person.email}</p>
                      <p>{a.person.phone || ""}</p>
                    </div>
                    <button onClick={() => removeAffiliation(a.id)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-chip-bad-fg hover:opacity-70 transition-opacity">Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Orders */}
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
            <h2 className="text-base font-semibold text-lt-fg mb-3">Orders</h2>
            {company.orders.length === 0 ? (
              <p className="text-lt-fg3 text-sm">No orders yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-lt-fg3 text-xs uppercase border-b border-lt-hairline">
                  <th className="py-2 text-left font-medium">Order #</th>
                  <th className="py-2 text-left font-medium">Description</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Total</th>
                  <th className="py-2 text-right font-medium">Date</th>
                </tr></thead>
                <tbody>
                  {company.orders.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/orders/${o.id}`)}
                      className="border-b border-lt-hairline/50 hover:bg-lt-inner/30 cursor-pointer">
                      <td className="py-2 text-lt-fg font-mono text-xs">{o.orderNumber}</td>
                      <td className="py-2 text-lt-fg2 text-xs">{o.description || "--"}</td>
                      <td className="py-2 text-center"><span className="text-xs text-lt-fg2">{o.status.replace("_", " ")}</span></td>
                      <td className="py-2 text-right text-lt-fg font-mono text-xs">{fmt(o.total)}</td>
                      <td className="py-2 text-right text-lt-fg2 text-xs">{fmtDate(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: Activity Feed */}
        <div className="space-y-4">
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
            <h2 className="text-base font-semibold text-lt-fg mb-3">Log Activity</h2>
            <div className="space-y-2">
              <select value={actType} onChange={(e) => setActType(e.target.value)}
                className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg">
                <option value="NOTE">Note</option><option value="CALL">Call</option>
                <option value="EMAIL">Email</option><option value="MEETING">Meeting</option>
                <option value="FOLLOW_UP">Follow-Up</option>
              </select>
              <input type="text" value={actSubject} onChange={(e) => setActSubject(e.target.value)} placeholder="Subject (optional)"
                className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg placeholder:text-lt-fg3" />
              <textarea value={actBody} onChange={(e) => setActBody(e.target.value)} placeholder="What happened?" rows={3}
                className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg placeholder:text-lt-fg3 resize-none" />
              {(actType === "FOLLOW_UP" || actType === "CALL") && (
                <input type="date" value={actDueDate} onChange={(e) => setActDueDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg" />
              )}
              <button onClick={addActivity} disabled={!actBody || saving}
                className="w-full py-2 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white text-sm font-medium rounded-lg transition-colors">
                {saving ? "Saving..." : "Log"}
              </button>
            </div>
          </div>

          <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
            <h2 className="text-base font-semibold text-lt-fg mb-3">Activity History</h2>
            {(() => {
              // Same timeline-merge as on the person detail page —
              // manual activities + auto-derived outbound emails, time-
              // sorted desc, emails rendered read-only with an EMAIL · SENT
              // chip and an "auto" hint so reps know it wasn't manually logged.
              const timeline = [
                ...company.activities.map((a) => ({ kind: 'activity' as const, at: a.createdAt, row: a })),
                ...(company.outreachActivities ?? []).map((o) => ({ kind: 'outreach' as const, at: o.occurredAt, row: o })),
                ...company.outboundEmails.map((e) => ({ kind: 'email' as const, at: e.sentAt, row: e })),
              ].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
              if (timeline.length === 0) {
                return <p className="text-lt-fg3 text-sm">No activity logged yet</p>;
              }
              return (
                <div className="space-y-3">
                  {timeline.map((item) =>
                    item.kind === 'outreach' ? (
                      <div key={`o-${item.row.id}`} className="border-b border-lt-hairline/50 pb-3 last:border-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-chip-good-bg text-chip-good-fg">
                            OUTREACH · {item.row.type.replace('_', ' ')}
                          </span>
                          <span className="text-[10px] text-lt-fg3">{item.row.createdBy.name}</span>
                          <span className="text-[10px] text-lt-fg3">{fmtDate(item.row.occurredAt)}</span>
                          {item.row.person && (
                            <span className="text-[10px] text-lt-fg2">| {item.row.person.firstName} {item.row.person.lastName}</span>
                          )}
                          {item.row.followUpAt && !item.row.followUpDone && (
                            <span className="text-[10px] text-chip-warn-fg ml-auto">Follow up {fmtDate(item.row.followUpAt)}</span>
                          )}
                          {item.row.followUpDone && <span className="text-[10px] text-chip-good-fg ml-auto">Done</span>}
                        </div>
                        <p className="text-xs text-lt-fg2 whitespace-pre-wrap break-words">{item.row.notes}</p>
                      </div>
                    ) : item.kind === 'activity' ? (
                      <div key={`a-${item.row.id}`} className="border-b border-lt-hairline/50 pb-3 last:border-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                            item.row.type === "CALL" ? "bg-chip-neutral-bg text-chip-neutral-fg" :
                            item.row.type === "EMAIL" ? "bg-chip-neutral-bg text-chip-neutral-fg" :
                            item.row.type === "MEETING" ? "bg-chip-neutral-bg text-chip-neutral-fg" :
                            item.row.type === "FOLLOW_UP" ? "bg-chip-bad-bg text-chip-bad-fg" :
                            "bg-lt-inner text-lt-fg2"
                          }`}>{item.row.type.replace("_", " ")}</span>
                          <span className="text-[10px] text-lt-fg3">{item.row.agent.name}</span>
                          <span className="text-[10px] text-lt-fg3">{fmtDate(item.row.createdAt)}</span>
                          {item.row.dueDate && !item.row.completed && (
                            <button onClick={() => completeActivity(item.row.id)} className="text-[10px] text-chip-good-fg hover:opacity-70 ml-auto">Complete</button>
                          )}
                          {item.row.completed && <span className="text-[10px] text-chip-good-fg ml-auto">Done</span>}
                        </div>
                        {item.row.subject && <p className="text-xs text-lt-fg font-medium">{item.row.subject}</p>}
                        <p className="text-xs text-lt-fg2">{item.row.body}</p>
                      </div>
                    ) : (
                      <div key={`e-${item.row.id}`} className="border-b border-lt-hairline/50 pb-3 last:border-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-cadence-booked-bg text-cadence-booked-fg">
                            EMAIL · SENT
                          </span>
                          <span className="text-[10px] text-lt-fg3">{fromHeaderDisplay(item.row.fromAddress)}</span>
                          <span className="text-[10px] text-lt-fg3">{fmtDate(item.row.sentAt)}</span>
                          <span className="text-[10px] text-lt-fg3 ml-auto" title="Auto-recorded from Gmail">auto</span>
                        </div>
                        <p className="text-xs text-lt-fg font-medium">{item.row.subject || '(no subject)'}</p>
                        {item.row.snippet && (
                          <p className="text-xs text-lt-fg2 line-clamp-2">{item.row.snippet}</p>
                        )}
                      </div>
                    )
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Link Contact Modal */}
      {showLinkContact && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowLinkContact(false)}>
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-lt-fg mb-4">Link Contact to {company.name}</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Search Contact</label>
                <input type="text" value={contactSearch} onChange={(e) => searchContacts(e.target.value)}
                  placeholder="Type name or email..."
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                {contactResults.length > 0 && !selectedContactId && (
                  <div className="mt-2 bg-lt-inner border border-lt-hairline rounded-lg max-h-60 overflow-y-auto">
                    {contactResults.map((c) => (
                      <button key={c.id} onClick={() => {
                        setSelectedContactId(c.id);
                        setContactSearch(`${c.firstName} ${c.lastName} (${c.email})`);
                        setContactResults([]);
                      }} className="w-full text-left px-3 py-2 hover:bg-lt-inner text-sm border-b border-lt-hairline last:border-0">
                        <p className="text-lt-fg">{c.firstName} {c.lastName}</p>
                        <p className="text-xs text-lt-fg2">{c.email} | {c.role.replace(/_/g, " ")}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Production / Show Name</label>
                <input type="text" value={linkProduction} onChange={(e) => setLinkProduction(e.target.value)}
                  placeholder="e.g. Stranger Things S5"
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
              </div>

              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Role on This Show</label>
                <select value={linkRole} onChange={(e) => setLinkRole(e.target.value)}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg">
                  <option value="">(same as contact default)</option>
                  <option value="UPM">UPM</option>
                  <option value="PRODUCER">Producer</option>
                  <option value="LINE_PRODUCER">Line Producer</option>
                  <option value="PRODUCTION_COORDINATOR">Production Coordinator</option>
                  <option value="PRODUCTION_SUPERVISOR">Production Supervisor</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={linkIsCurrent} onChange={(e) => setLinkIsCurrent(e.target.checked)}
                  className="w-4 h-4 rounded" />
                <span className="text-sm text-lt-fg2">Currently active on this show</span>
              </label>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={linkContact} disabled={!selectedContactId}
                className="px-4 py-2 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white text-sm font-medium rounded-lg">
                Link Contact
              </button>
              <button onClick={() => setShowLinkContact(false)} className="px-4 py-2 text-lt-fg2 hover:text-lt-fg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showLogOutreach && (
        <OutreachQuickLogModal
          presetCompany={{ id: company.id, name: company.name }}
          onClose={() => setShowLogOutreach(false)}
          onSaved={() => { fetchCompany(); }}
        />
      )}
      </div>
    </div>
  );
}
