'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { LineItemDepartment, RateType } from '@prisma/client';
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
  rentalDays: number;
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

interface AttachableJob {
  id: string;
  jobCode: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  company: { id: string; name: string };
  agent: { id: string; name: string };
}

interface InquiryRecord {
  id: string;
  title: string;
  description: string;
  estimatedValue: number | null;
  preferredStartDate: string | null;
  preferredEndDate: string | null;
  company: { id: string; name: string } | null;
  person: { id: string; firstName: string; lastName: string; email: string } | null;
  status: 'NEW' | 'CONVERTED' | 'DISMISSED';
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

  const [mode, setMode] = useState<'new' | 'attach'>('new');
  const [attachJobId, setAttachJobId] = useState<string | null>(null);
  const [attachableJobs, setAttachableJobs] = useState<AttachableJob[] | null>(null);
  const [attachedJob, setAttachedJob] = useState<AttachableJob | null>(null);

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

  const [creating, setCreating] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountLabel, setDiscountLabel] = useState('');

  // Phase 1 brief: inquiryId + attach-to-existing-Job are incompatible.
  // Attach wins; warn and clear inquiry context.
  useEffect(() => {
    if (mode === 'attach' && inquiry) {
      console.warn('[new-quote] attach-to-existing-Job mode wins over inquiryId — inquiry context discarded.');
      setInquiry(null);
    }
  }, [mode, inquiry]);

  // Load attachable jobs once when entering attach mode.
  useEffect(() => {
    if (mode !== 'attach' || attachableJobs !== null) return;
    fetch('/api/jobs?statuses=QUOTED&include=quoteStatus')
      .then((r) => r.json())
      .then((d) => setAttachableJobs(d.jobs || []))
      .catch(() => setAttachableJobs([]));
  }, [mode, attachableJobs]);

  // Sync the picked job's full record for read-only display.
  useEffect(() => {
    if (!attachJobId) {
      setAttachedJob(null);
      return;
    }
    const j = (attachableJobs || []).find((x) => x.id === attachJobId);
    setAttachedJob(j || null);
  }, [attachJobId, attachableJobs]);

  // Inquiry prefill — only when ?inquiryId is set AND mode is "new".
  useEffect(() => {
    if (!inquiryId || mode === 'attach') return;
    fetch(`/api/inquiries/${inquiryId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.inquiry) return;
        const inq: InquiryRecord = d.inquiry;
        setInquiry(inq);
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
  }, [inquiryId, mode]);

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
      if (data.clientMatch?.length === 1 && !selectedClientId) {
        setSelectedClientId(data.clientMatch[0].id);
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
    } finally {
      setParsing(false);
    }
  };

  const updateItem = (idx: number, patch: Partial<ResolvedItem>) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next: ResolvedItem = { ...it, ...patch };

        // Department change: always normalize rateType to DAILY (or FLAT for
        // EXPENDABLES). Cap-per-week math doesn't carry over across dept
        // boundaries; safer to reset and let the user re-pick.
        if (patch.department !== undefined && patch.department !== it.department) {
          if (next.department === 'EXPENDABLES') {
            if (next.rateType !== 'FLAT') {
              next.rateType = 'FLAT';
              next.rateTypeAutoResetNote = 'Rate type reset to Purchase — Expendables are always purchases.';
            }
          } else if (next.rateType !== 'DAILY') {
            next.rateType = 'DAILY';
            next.rateTypeAutoResetNote = 'Rate type reset to Daily — billing changes with department.';
          }
        } else if (patch.rentalDays !== undefined && patch.rentalDays !== it.rentalDays) {
          // rentalDays change: keep the rateType if it's still valid;
          // otherwise step down to the highest tier that fits.
          const valid = availableRateTypes(next.department, next.rentalDays);
          if (!valid.includes(next.rateType)) {
            const reset = defaultRateType(next.department, next.rentalDays);
            const reason =
              next.rateType === 'MONTHLY'
                ? 'Monthly requires more than 28 days'
                : next.rateType === 'WEEKLY'
                  ? 'Weekly requires more than 7 days'
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

  const addBlankItem = () => {
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
        rentalDays: 1,
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
          rentalDays: it.rentalDays,
          rateType: it.rateType,
          department: it.department,
        }),
      0,
    );
    const discount = parseFloat(discountAmount) || 0;
    return lineSum + discount;
  }, [items, discountAmount]);

  const canCreate = mode === 'attach'
    ? !!attachJobId && items.length > 0
    : !!selectedClientId && items.length > 0;

  const createQuote = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      let jobId: string;
      let companyId: string;

      if (mode === 'attach') {
        if (!attachedJob) { alert('Pick an existing job to attach to.'); setCreating(false); return; }
        jobId = attachedJob.id;
        companyId = attachedJob.company.id;
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

        // Auto-create Job (existing fallback flow per CLAUDE.md). Phase 5
        // will add a proper Job-selection UX for new quotes.
        const jobName =
          editing.productionName ||
          parsed?.productionName ||
          inquiry?.title ||
          `Quote — ${parsed?.clientName || 'Untitled'} — ${new Date().toLocaleDateString()}`;
        const jobRes = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: jobName,
            companyId: finalClientId,
            agentId: (session?.user as { id?: string })?.id,
            startDate: editing.startDate || null,
            endDate: editing.endDate || null,
            notes: inquiry ? `Created from Inquiry: ${inquiry.title}` : 'Auto-created from quote parser',
          }),
        });
        if (!jobRes.ok) {
          const err = await jobRes.json();
          alert('Failed to create job: ' + (err.error || 'unknown'));
          setCreating(false);
          return;
        }
        const jobData = await jobRes.json();
        jobId = jobData.job.id;
      }

      // Create Order
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          jobId,
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
            rentalDays: it.rentalDays,
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

      // Mark inquiry CONVERTED if we came from one (and we're in new-job mode)
      if (inquiry && mode === 'new') {
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
        <button onClick={() => router.push('/orders')} className="text-sm text-zinc-400 hover:text-white">
          &larr; Back to Orders
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-white">New Quote</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Paste an email or upload a PDF. AI extracts line items + matches them against the catalog.
          </p>
        </div>

        <ModeToggle mode={mode} setMode={setMode} />

        {mode === 'attach' && (
          <AttachJobPicker
            jobs={attachableJobs}
            selected={attachJobId}
            onSelect={setAttachJobId}
            attachedJob={attachedJob}
          />
        )}

        {inquiry && mode === 'new' && (
          <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-xl p-3 text-[12px] text-emerald-300">
            Prefilled from Inquiry: <span className="font-semibold">{inquiry.title}</span>
            {inquiry.company && <> · <span className="text-emerald-400">{inquiry.company.name}</span></>}
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
      <button onClick={() => { setParsed(null); setItems([]); }} className="text-sm text-zinc-400 hover:text-white">
        &larr; Start Over
      </button>
      <div>
        <h1 className="text-2xl font-semibold text-white">Review Quote</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Adjust each line item. Departments, rates, and rate-types are editable per row.
        </p>
      </div>

      {/* Header context — Job summary if attached, else editable client/dates */}
      {mode === 'attach' && attachedJob ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">Attaching to existing Job</div>
          <div className="text-base font-semibold text-white">
            [{attachedJob.jobCode}] {attachedJob.name}
          </div>
          <div className="text-[12px] text-zinc-400">
            {attachedJob.company.name}
            {attachedJob.startDate && (
              <> · {new Date(attachedJob.startDate).toLocaleDateString()} → {attachedJob.endDate ? new Date(attachedJob.endDate).toLocaleDateString() : '?'}</>
            )}
          </div>
        </div>
      ) : (
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
              <div className="text-sm text-amber-400 bg-amber-900/20 border border-amber-900/40 rounded-lg p-3">
                No client extracted. <a href="/crm" className="underline">Pick one in CRM first</a>.
              </div>
            )}
            {parsed?.clientName && (
              <p className="text-xs text-zinc-500 mt-1">AI extracted: <span className="text-zinc-300">{parsed.clientName}</span></p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Production Name</label>
              <input
                type="text" value={editing.productionName || ''}
                onChange={(e) => setEditing({ ...editing, productionName: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Start Date</label>
              <input
                type="date" value={editing.startDate || ''}
                onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">End Date</label>
              <input
                type="date" value={editing.endDate || ''}
                onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* Line items */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Line Items ({items.length})</h2>
          <button onClick={addBlankItem} className="text-[11px] font-semibold text-zinc-400 hover:text-white">
            + Add line manually
          </button>
        </div>
        <div className="space-y-2">
          {items.map((it, idx) => (
            <LineItemRow key={idx} item={it} idx={idx} onChange={updateItem} onDelete={removeItem} />
          ))}
          {items.length === 0 && (
            <div className="text-xs text-zinc-600 text-center py-6">No line items.</div>
          )}
        </div>
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
        <div className="flex gap-2">
          <button
            onClick={() => { setParsed(null); setItems([]); }}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={createQuote}
            disabled={!canCreate || creating}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm font-bold rounded-lg"
          >
            {creating ? 'Creating Quote…' : 'Create Quote'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function ModeToggle({ mode, setMode }: { mode: 'new' | 'attach'; setMode: (m: 'new' | 'attach') => void }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-1 inline-flex w-fit">
      {(['new', 'attach'] as const).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`px-3 py-1.5 text-[12px] font-semibold rounded ${
            mode === m ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          {m === 'new' ? 'New Job' : 'Attach to existing Job'}
        </button>
      ))}
    </div>
  );
}

function AttachJobPicker({
  jobs, selected, onSelect, attachedJob,
}: {
  jobs: AttachableJob[] | null;
  selected: string | null;
  onSelect: (id: string) => void;
  attachedJob: AttachableJob | null;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">Pick a Quoted Job</div>
      {jobs === null ? (
        <div className="text-xs text-zinc-600">Loading jobs…</div>
      ) : jobs.length === 0 ? (
        <div className="text-xs text-zinc-600">No QUOTED jobs available. Create a new one instead.</div>
      ) : (
        <select
          value={selected || ''}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
        >
          <option value="">— Select —</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              [{j.jobCode}] {j.name} — {j.company.name}
            </option>
          ))}
        </select>
      )}
      {attachedJob && (
        <div className="text-[11px] text-zinc-500">
          Selected: {attachedJob.company.name}
          {attachedJob.startDate && (
            <> · {new Date(attachedJob.startDate).toLocaleDateString()} → {attachedJob.endDate ? new Date(attachedJob.endDate).toLocaleDateString() : '?'}</>
          )}
        </div>
      )}
    </div>
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
    rentalDays: item.rentalDays,
    rateType: item.rateType,
    department: item.department,
  });
  const breakdown = billingBreakdown({
    quantity: item.quantity,
    rate: item.rate,
    rentalDays: item.rentalDays,
    rateType: item.rateType,
    department: item.department,
  });
  const matched = item.catalogProductId != null;
  const isExpendable = item.department === 'EXPENDABLES';
  const allowedRateTypes = availableRateTypes(item.department, item.rentalDays);
  // Toggle order: always show DAILY/WEEKLY for non-expendables; STAGES gets MONTHLY too.
  const visibleRateTypes: RateType[] = isExpendable
    ? ['FLAT']
    : item.department === 'STAGES'
      ? ['DAILY', 'WEEKLY', 'MONTHLY']
      : ['DAILY', 'WEEKLY'];

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

  return (
    <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-950">
      <div className="flex items-start gap-2 mb-2">
        <input
          type="text"
          value={item.description}
          onChange={(e) => onChange(idx, { description: e.target.value })}
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-white font-semibold focus:outline-none focus:border-zinc-600"
        />
        <DepartmentTag
          department={item.department}
          onChange={(d) => onChange(idx, { department: d })}
        />
        <button
          onClick={() => onDelete(idx)}
          className="text-zinc-600 hover:text-red-400 text-sm px-1"
          title="Remove line"
        >
          ×
        </button>
      </div>

      {item.qualifier && (
        <div className="text-[11px] text-zinc-400 italic mb-1.5">— {item.qualifier}</div>
      )}

      {/* Match status */}
      {matched ? (
        <div className="flex items-center gap-2 mb-2 text-[11px]">
          <span className="bg-emerald-900/40 text-emerald-300 px-2 py-0.5 rounded font-semibold">
            ✓ Matched: {item.matchedProduct?.name}
          </span>
          {item.matchSource === 'ALIAS_FALLBACK' && (
            <span className="text-zinc-500 text-[10px]">(via alias fallback)</span>
          )}
          <button
            onClick={() => setShowOverride((s) => !s)}
            className="text-zinc-500 hover:text-white underline decoration-dotted"
          >
            Change match
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-2 text-[11px]">
          <span className="bg-amber-900/40 text-amber-300 px-2 py-0.5 rounded font-semibold">
            ⚠ No catalog match — pick one
          </span>
        </div>
      )}

      {showOverride && (
        <div className="mb-2 p-2 border border-zinc-800 rounded bg-zinc-900">
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

      {/* Numeric controls */}
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-2">
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Qty</label>
          <input
            type="number" min={1} value={item.quantity}
            onChange={(e) => onChange(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-white font-mono"
          />
        </div>
        <div className="col-span-3">
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Rate</label>
          <input
            type="number" step="0.01" value={item.rate}
            onChange={(e) => onChange(idx, { rate: Number(e.target.value) || 0 })}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-white font-mono"
          />
        </div>
        {isExpendable ? (
          <div className="col-span-5">
            <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Billing</label>
            <div className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[11px] text-zinc-300">
              <span className="font-semibold text-orange-300">Purchase</span>
              <span className="text-zinc-500 ml-2">(no rental days — qty × rate)</span>
            </div>
          </div>
        ) : (
          <>
            <div className="col-span-3">
              <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Rate type</label>
              <div className="flex bg-zinc-900 border border-zinc-800 rounded p-0.5">
                {visibleRateTypes.map((rt) => {
                  const enabled = allowedRateTypes.includes(rt);
                  const reason =
                    rt === 'WEEKLY' && !enabled
                      ? 'Available at >7 days'
                      : rt === 'MONTHLY' && !enabled
                        ? 'Stages-only, available at >28 days'
                        : '';
                  return (
                    <button
                      key={rt}
                      onClick={() => enabled && onChange(idx, { rateType: rt })}
                      disabled={!enabled}
                      title={reason}
                      className={`flex-1 px-2 py-1 text-[11px] font-semibold rounded ${
                        item.rateType === rt
                          ? 'bg-amber-600 text-white'
                          : enabled
                            ? 'text-zinc-400 hover:text-white'
                            : 'text-zinc-700 cursor-not-allowed'
                      }`}
                    >
                      {rt === 'DAILY' ? 'Day' : rt === 'WEEKLY' ? 'Week' : 'Month'}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Days</label>
              <input
                type="number" min={1} value={item.rentalDays}
                onChange={(e) => onChange(idx, { rentalDays: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-white font-mono"
              />
            </div>
          </>
        )}
        <div className="col-span-2 text-right">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Total</div>
          <div className="text-sm font-mono text-emerald-400">{fmtMoney(total)}</div>
        </div>
      </div>

      <div className="mt-1.5 text-[10px] text-zinc-500 leading-tight">{breakdown}</div>
      {item.rateTypeAutoResetNote && (
        <div className="mt-1 text-[10px] text-amber-400 italic">{item.rateTypeAutoResetNote}</div>
      )}
    </div>
  );
}

function DepartmentTag({
  department, onChange,
}: {
  department: LineItemDepartment;
  onChange: (d: LineItemDepartment) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        value={department}
        onChange={(e) => { onChange(e.target.value as LineItemDepartment); setEditing(false); }}
        onBlur={() => setEditing(false)}
        autoFocus
        className="text-[10px] font-bold bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-white"
      >
        {DEPARTMENTS.map((d) => (
          <option key={d} value={d}>{DEPARTMENT_LABEL[d]}</option>
        ))}
      </select>
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${DEPT_BADGE[department]}`}
      title={`${DEPARTMENT_LABEL[department]} — click to override`}
    >
      {DEPARTMENT_SHORT[department]}
    </button>
  );
}
