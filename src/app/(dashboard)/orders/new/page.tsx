'use client'

/**
 * Order create wizard (Phase B of order-builder consolidation).
 *
 * Replaces the old blank-shell page at /orders/new. ONE entry, three
 * modes:
 *   1. Blank        — no params; rep picks company + job + creates an
 *                     empty DRAFT, then adds lines on /orders/[id].
 *   2. Paste-to-parse — rep pastes email text or uploads a PDF →
 *                       POST /api/orders/parse-quote → preview →
 *                       create DRAFT.
 *   3. ?inquiryId= / ?clientCompanyId=  — pre-fills from the inquiry
 *                       record. The 8 inquiry-conversion entries on
 *                       new-quote still point at /orders/new-quote
 *                       (Phase D repoints them). This wizard wires
 *                       the param handling now so it's ready.
 *
 * Submit always POSTs `/api/orders/from-parse` — atomic
 * Company+Job+Person+Order+LineItems transaction (Phase A endpoint).
 * On 201 we redirect to `/orders/[id]` for further editing; any
 * `warnings[]` are passed through via sessionStorage so the order
 * detail can surface them.
 *
 * Reuse policy (per the spec): only TRULY-shared leaf components
 * (`CompanyPicker`, `JobPicker`) are imported. The contacts list +
 * items preview + parse box are re-implemented thinly here rather
 * than extracted from new-quote — new-quote is retired in Phase D,
 * sharing with a soon-dead page is wasted work.
 *
 * Out of scope (deferred):
 *   - Supply-cart hydration (`?inquiryId=` for WEB_FORM
 *     `kind='supply-order'`): Phase B.2 — see TODO in the inquiry
 *     prefill effect.
 *   - Per-row date inputs on the items preview: Phase C.
 *   - Repointing the "+ New Quote" + 8 inquiry-conversion entries
 *     away from /orders/new-quote: Phase D.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import type { JobRole, LineItemDepartment, ProductionType } from '@prisma/client'
import {
  CompanyPicker,
  EMPTY_COMPANY_PICKER_VALUE,
  type CompanyPickerValue,
} from '@/components/shared/CompanyPicker'
import {
  JobPicker,
  EMPTY_JOB_PICKER_VALUE,
  type JobPickerValue,
} from '@/components/shared/JobPicker'

// ─────────────────────────────────────────────────────────────────────
// Shapes (subset of new-quote's — kept loose here since we just relay
// them to /api/orders/from-parse which has the full schema)
// ─────────────────────────────────────────────────────────────────────

interface ParsedTop {
  clientName?: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  productionName?: string
  startDate?: string
  endDate?: string
  pickupLocation?: string
  dropoffLocation?: string
  notes?: string
}

interface ResolvedItem {
  description: string
  quantity: number
  catalogProductId: string | null
  catalogType: 'INVENTORY' | 'ASSET_CATEGORY' | 'PACKAGE' | null
  department: LineItemDepartment
  qualifier: string | null
  rateType: 'DAILY' | 'WEEKLY'
  pickupDate: string
  returnDate: string
  billableDays: number | null
  rate: number
  matchedProduct: { id: string; type: string; name: string } | null
  matchSource: 'AI' | 'ALIAS_FALLBACK' | null
  warnings: string[]
}

type SuggestedJobRole = 'PRODUCER' | 'PM' | 'PC' | 'TRANSPO' | 'ACCOUNTING' | 'OTHER'
const JOB_ROLES: SuggestedJobRole[] = ['PRODUCER', 'PM', 'PC', 'TRANSPO', 'ACCOUNTING', 'OTHER']

interface WizardContact {
  name: string
  email: string
  title: string | null
  phone: string | null
  company: string | null
  source: 'header' | 'signature' | 'body_mention'
  confidence: 'high' | 'medium' | 'low'
  match_status: 'existing' | 'new' | 'possible_match'
  existing_person_id: string | null
  candidate_person_id: string | null
  include: boolean
  role: SuggestedJobRole
  decision?: 'merge' | 'create_new'
}

interface ClientCandidate {
  id: string
  name: string
  tier: string
  coiOnFile?: boolean
}

const DEPT_LABEL: Record<LineItemDepartment, string> = {
  VEHICLES: 'VEH',
  COMMUNICATIONS: 'COM',
  STAGES: 'STG',
  GE: 'G&E',
  PRO_SUPPLIES: 'PS',
  EXPENDABLES: 'EXP',
  ART: 'ART',
}

function hydrateContacts(api: unknown): WizardContact[] {
  if (!Array.isArray(api)) return []
  return api.map((c: Record<string, unknown>) => {
    const role: SuggestedJobRole = (c.suggested_role as SuggestedJobRole) || 'OTHER'
    return {
      name: String(c.name || ''),
      email: String(c.email || ''),
      title: (c.title as string | null) ?? null,
      phone: (c.phone as string | null) ?? null,
      company: (c.company as string | null) ?? null,
      source: c.source as WizardContact['source'],
      confidence: c.confidence as WizardContact['confidence'],
      match_status: c.match_status as WizardContact['match_status'],
      existing_person_id: (c.existing_person_id as string | null) ?? null,
      candidate_person_id: (c.candidate_person_id as string | null) ?? null,
      include: c.confidence !== 'low',
      role,
      decision: c.match_status === 'possible_match' ? 'create_new' : undefined,
    }
  })
}

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────

export default function NewOrderPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-lt-fg2">Loading…</div>}>
      <NewOrderWizardInner />
    </Suspense>
  )
}

function NewOrderWizardInner() {
  const router = useRouter()
  const search = useSearchParams()
  useSession() // ensure session is present; submit gates server-side too
  const inquiryId = search.get('inquiryId')
  const clientCompanyIdFromUrl = search.get('clientCompanyId')

  // Parse-box state
  const [inputMode, setInputMode] = useState<'paste' | 'pdf'>('paste')
  const [emailText, setEmailText] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')

  // Parsed payload
  const [parsed, setParsed] = useState<ParsedTop | null>(null)
  const [items, setItems] = useState<ResolvedItem[]>([])
  const [contacts, setContacts] = useState<WizardContact[]>([])
  const [clientCandidates, setClientCandidates] = useState<ClientCandidate[]>([])

  // Decisions
  const [companyPick, setCompanyPick] = useState<CompanyPickerValue>(EMPTY_COMPANY_PICKER_VALUE)
  const [job, setJob] = useState<JobPickerValue>(EMPTY_JOB_PICKER_VALUE)
  // Order header fields the rep can override post-parse.
  const [productionName, setProductionName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  // Optional discount.
  const [discountAmount, setDiscountAmount] = useState('')
  const [discountLabel, setDiscountLabel] = useState('')
  // Optional inline-job production type when creating-new.
  const [newJobProductionType, setNewJobProductionType] = useState<ProductionType>('OTHER')

  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // ── Parse handlers ────────────────────────────────────────────────
  const applyParseResult = useCallback((data: {
    parsed?: ParsedTop
    items?: ResolvedItem[]
    clientMatch?: ClientCandidate[]
    contacts?: unknown
  }) => {
    setParsed(data.parsed ?? null)
    setItems(Array.isArray(data.items) ? data.items : [])
    setClientCandidates(Array.isArray(data.clientMatch) ? data.clientMatch : [])
    setContacts(hydrateContacts(data.contacts))
    // Seed editable header fields from parse — rep can override before save.
    if (data.parsed?.productionName && !productionName) setProductionName(data.parsed.productionName)
    if (data.parsed?.startDate && !startDate) setStartDate(data.parsed.startDate)
    if (data.parsed?.endDate && !endDate) setEndDate(data.parsed.endDate)
    if (data.parsed?.notes && !notes) setNotes(data.parsed.notes)
    // Auto-pick the company when there's exactly one fuzzy hit.
    if (Array.isArray(data.clientMatch) && data.clientMatch.length === 1 && companyPick.mode === 'searching') {
      const c = data.clientMatch[0]
      setCompanyPick({
        companyId: c.id, name: c.name, mode: 'selected_existing',
        tier: c.tier, coiOnFile: c.coiOnFile ?? null,
      })
    }
  }, [productionName, startDate, endDate, notes, companyPick.mode])

  const parseEmail = async () => {
    if (!emailText.trim()) return
    setParsing(true); setParseError('')
    try {
      const res = await fetch('/api/orders/parse-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: emailText }),
      })
      const data = await res.json()
      if (!res.ok) { setParseError(data.error || 'Parse failed'); return }
      applyParseResult(data)
    } finally {
      setParsing(false)
    }
  }

  const parsePDF = async () => {
    if (!pdfFile) return
    setParsing(true); setParseError('')
    try {
      const fd = new FormData()
      fd.append('file', pdfFile)
      const pdfRes = await fetch('/api/orders/parse-pdf', { method: 'POST', body: fd })
      const pdfData = await pdfRes.json()
      if (!pdfRes.ok) { setParseError(pdfData.error || 'PDF parse failed'); return }
      setEmailText(pdfData.text)
      const parseRes = await fetch('/api/orders/parse-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pdfData.text }),
      })
      const parseData = await parseRes.json()
      if (!parseRes.ok) { setParseError(parseData.error || 'Parse failed'); return }
      applyParseResult(parseData)
    } finally {
      setParsing(false)
    }
  }

  // ── URL param prefill (entry mode 3) ──────────────────────────────
  // Inquiry pre-fill: fetch the inquiry record, auto-paste its
  // description into the parse box, and run parseEmail. Supply-order
  // inquiries (WEB_FORM kind='supply-order') are PHASE B.2 — for now
  // they fall through to the email-parse path which is a no-op on
  // their generated descriptions.
  useEffect(() => {
    if (!inquiryId) return
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/inquiries/${inquiryId}`)
      if (!res.ok) return
      const d = await res.json()
      if (cancelled || !d?.inquiry) return
      const inq = d.inquiry
      // TODO(Phase B.2): if inq.sourceMetadata?.kind === 'supply-order',
      // map inq.sourceMetadata.cart → ResolvedItem[] directly (no AI parse).
      // For now the supply-cart entry points still go through new-quote.
      const desc = (inq.description as string | undefined) ?? ''
      if (desc.trim() && !emailText.trim()) {
        setEmailText(desc)
        // Auto-parse so the rep lands on a prefilled wizard.
        setParsing(true)
        setParseError('')
        try {
          const parseRes = await fetch('/api/orders/parse-quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: desc }),
          })
          const parseData = await parseRes.json()
          if (parseRes.ok) applyParseResult(parseData)
          else setParseError(parseData.error || 'Parse failed')
        } finally {
          setParsing(false)
        }
      }
      if (inq.company && companyPick.mode === 'searching') {
        setCompanyPick({
          companyId: inq.company.id, name: inq.company.name,
          mode: 'selected_existing', tier: inq.company.tier ?? null, coiOnFile: null,
        })
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiryId])

  // Round-trip from /crm with ?clientCompanyId= — fetch + select.
  useEffect(() => {
    if (!clientCompanyIdFromUrl) return
    let cancelled = false
    fetch(`/api/crm/companies/${clientCompanyIdFromUrl}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.id) return
        setCompanyPick({
          companyId: d.id, name: d.name, mode: 'selected_existing',
          tier: d.tier ?? null, coiOnFile: d.coiOnFile ?? null,
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [clientCompanyIdFromUrl])

  // ── Item-removal (presentation-only edit allowed per spec) ────────
  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  // ── Contact-toggle ────────────────────────────────────────────────
  const toggleContact = (idx: number, include: boolean) => {
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, include } : c)))
  }
  const setContactRole = (idx: number, role: SuggestedJobRole) => {
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, role } : c)))
  }

  // ── Submit ────────────────────────────────────────────────────────
  // Gate: company + job both decided (existing or creating_new with a
  // typed name). Lines optional — empty array creates an empty DRAFT
  // (the rep fills it in on /orders/[id]).
  const companyDecided =
    companyPick.mode === 'selected_existing' ||
    (companyPick.mode === 'creating_new' && companyPick.name.trim().length > 0)
  const jobDecided =
    job.mode === 'selected_existing' ||
    (job.mode === 'creating_new' && job.name.trim().length > 0)
  const canCreate = companyDecided && jobDecided && !creating

  const createDraft = async () => {
    if (!canCreate) return
    setCreating(true); setCreateError('')
    try {
      const companyDecision =
        companyPick.mode === 'selected_existing' && companyPick.companyId
          ? { kind: 'existing' as const, companyId: companyPick.companyId }
          : {
              kind: 'new' as const,
              name: companyPick.name.trim(),
              billingEmail: parsed?.contactEmail || null,
            }
      const jobDecision =
        job.mode === 'selected_existing' && job.jobId
          ? { kind: 'existing' as const, jobId: job.jobId }
          : {
              kind: 'new' as const,
              name: job.name.trim(),
              productionType: newJobProductionType,
              startDate: startDate || null,
              endDate: endDate || null,
              notes: notes || null,
            }
      // Contacts: only the rep-confirmed `include` rows go through.
      // 'merge' decisions adopt the existing CRM Person via
      // candidate_person_id; 'create_new' (default for new + possible-
      // match-without-merge) mints a fresh Person inside the
      // from-parse transaction.
      const contactsDecision = contacts.filter((c) => c.include && c.email).map((c) => {
        const adoptExisting =
          c.match_status === 'existing'
            ? c.existing_person_id
            : c.match_status === 'possible_match' && c.decision === 'merge'
              ? c.candidate_person_id
              : null
        if (adoptExisting) {
          return {
            kind: 'existing_person' as const,
            personId: adoptExisting,
            role: c.role as unknown as JobRole,
            isPrimary: false,
          }
        }
        const parts = (c.name || c.email).trim().split(/\s+/)
        const firstName = parts[0] || c.email.split('@')[0]
        const lastName = parts.slice(1).join(' ') || '(unknown)'
        return {
          kind: 'new_person' as const,
          firstName, lastName,
          email: c.email,
          phone: c.phone ?? null,
          title: c.title ?? null,
          source: 'quote_wizard',
          role: c.role as unknown as JobRole,
          isPrimary: false,
        }
      })

      const discount = discountAmount && Number(discountAmount) !== 0
        ? { amount: Number(discountAmount), label: discountLabel || null }
        : undefined

      // parse-quote emits catalog matches as catalogProductId + catalogType;
      // /api/orders/from-parse binds lines via inventoryItemId / assetCategoryId.
      // Translate here so the catalog linkage (and hold-tracking for
      // VEHICLES/STAGES) survives the create — without this the matched
      // product is dropped and every line lands unbound.
      const itemsPayload = items.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        rate: it.rate,
        rateType: it.rateType,
        department: it.department,
        qualifier: it.qualifier,
        catalogType: it.catalogType,
        inventoryItemId: it.catalogType === 'INVENTORY' ? it.catalogProductId : null,
        assetCategoryId: it.catalogType === 'ASSET_CATEGORY' ? it.catalogProductId : null,
        pickupDate: it.pickupDate || null,
        returnDate: it.returnDate || null,
        billableDays: it.billableDays,
      }))

      const body = {
        companyDecision,
        jobDecision,
        contactsDecision,
        items: itemsPayload,
        parsed: {
          startDate: startDate || null,
          endDate: endDate || null,
          notes: notes || null,
          productionName: productionName || parsed?.productionName || null,
        },
        ...(discount ? { discount } : {}),
      }

      const res = await fetch('/api/orders/from-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.reason || data.error || `Create failed (HTTP ${res.status})`)
        return
      }
      // Pass warnings through to the order detail via sessionStorage so
      // the rep sees them on landing. /orders/[id] will read + clear
      // this key on mount (added in Phase B when surface is wired —
      // for now the data lives here and Phase C surface it).
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        try {
          sessionStorage.setItem(
            `fromParseWarnings:${data.orderId}`,
            JSON.stringify(data.warnings),
          )
        } catch {/* sessionStorage unavailable — no-op */}
      }
      router.push(`/orders/${data.orderId}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'create failed')
    } finally {
      setCreating(false)
    }
  }

  const itemsCount = items.length
  const contactsIncluded = contacts.filter((c) => c.include).length

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-4xl mx-auto space-y-4">
        <button onClick={() => router.push('/orders')} className="text-sm text-lt-fg3 hover:text-lt-fg">
          &larr; Back to Orders
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-lt-fg">New Order</h1>
          <p className="text-sm text-lt-fg2 mt-1">
            Paste an email, upload a PDF, or skip parsing and build manually on the next page.
            Creates a DRAFT order — edit lines / dates / details on the order detail page.
          </p>
        </div>

        {/* PARSE BOX */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-bold text-lt-fg">Parse (optional)</h2>
            <div className="flex gap-1 bg-lt-inner rounded-lg p-0.5 w-fit">
              {(['paste', 'pdf'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setInputMode(m)}
                  className={`px-3 py-1 rounded-md text-xs font-medium ${
                    inputMode === m ? 'bg-white text-lt-fg' : 'text-lt-fg2 hover:text-lt-fg'
                  }`}
                >
                  {m === 'paste' ? 'Paste email' : 'Upload PDF'}
                </button>
              ))}
            </div>
          </div>
          {inputMode === 'paste' ? (
            <>
              <textarea
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                placeholder="Paste the client's email or quote request here…"
                rows={8}
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3 resize-y"
              />
              <button
                type="button"
                onClick={parseEmail}
                disabled={!emailText.trim() || parsing}
                className="px-4 py-2 bg-lt-fg hover:bg-black disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-medium rounded-lg"
              >
                {parsing ? 'AI is parsing…' : 'Parse with AI'}
              </button>
            </>
          ) : (
            <>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-lt-fg2 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-lt-inner file:text-lt-fg file:cursor-pointer"
              />
              {pdfFile && (
                <p className="text-xs text-lt-fg2">{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</p>
              )}
              <button
                type="button"
                onClick={parsePDF}
                disabled={!pdfFile || parsing}
                className="px-4 py-2 bg-lt-fg hover:bg-black disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-medium rounded-lg"
              >
                {parsing ? 'AI is processing PDF…' : 'Upload & Parse'}
              </button>
            </>
          )}
          {parseError && (
            <div className="text-xs text-chip-bad-fg bg-chip-bad-bg/30 rounded px-2 py-1.5">{parseError}</div>
          )}
          {parsed && (
            <p className="text-[11px] text-lt-fg3">
              Parsed{parsed.clientName ? ` · client guess: ${parsed.clientName}` : ''}
              {itemsCount > 0 && ` · ${itemsCount} line item${itemsCount === 1 ? '' : 's'}`}
              {contacts.length > 0 && ` · ${contacts.length} contact${contacts.length === 1 ? '' : 's'}`}
            </p>
          )}
        </div>

        {/* CLIENT */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-bold text-lt-fg">Client Company</h2>
          {clientCandidates.length > 0 && companyPick.mode === 'searching' && (
            <div className="text-[11px] text-lt-fg3">
              AI suggested:{' '}
              {clientCandidates.slice(0, 4).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCompanyPick({
                    companyId: c.id, name: c.name, mode: 'selected_existing',
                    tier: c.tier, coiOnFile: c.coiOnFile ?? null,
                  })}
                  className="inline-block mr-1.5 mb-1 px-2 py-0.5 rounded border border-lt-hairline hover:border-chip-good-fg/50 text-lt-fg"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <CompanyPicker
            value={companyPick}
            onChange={setCompanyPick}
            placeholder={parsed?.clientName ? `e.g. ${parsed.clientName}` : 'Search companies or type a new name…'}
          />
          {parsed?.clientName && companyPick.mode === 'searching' && (
            <p className="text-xs text-lt-fg3">AI extracted: <span className="text-lt-fg2">{parsed.clientName}</span></p>
          )}
        </div>

        {/* JOB */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-bold text-lt-fg">Job</h2>
          <JobPicker
            value={job}
            onChange={setJob}
            companyId={companyPick.mode === 'selected_existing' ? companyPick.companyId : null}
            placeholder="Search jobs by name or code, or type a new name…"
          />
          {job.mode === 'creating_new' && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-lt-hairline/60">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-lt-fg3 mb-1">Production type</label>
                <select
                  value={newJobProductionType}
                  onChange={(e) => setNewJobProductionType(e.target.value as ProductionType)}
                  className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-[12px] text-lt-fg"
                >
                  <option value="FILM">Film</option>
                  <option value="TV">TV</option>
                  <option value="COMMERCIAL">Commercial</option>
                  <option value="MUSIC_VIDEO">Music Video</option>
                  <option value="CORPORATE">Corporate</option>
                  <option value="EVENT_PLANNER">Event Planner</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* HEADER FIELDS — production name + dates + notes */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-lt-fg">Order details</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[10px] uppercase tracking-wider text-lt-fg3 mb-1">Production / job description</label>
              <input
                type="text"
                value={productionName}
                onChange={(e) => setProductionName(e.target.value)}
                placeholder={parsed?.productionName || 'e.g. Stranger Things S5 — Atlanta unit'}
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-lt-fg3 mb-1">Pickup date</label>
              <input
                type="date" value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-lt-fg3 mb-1">Return date</label>
              <input
                type="date" value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] uppercase tracking-wider text-lt-fg3 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Context, client preferences, deal notes…"
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg resize-y"
              />
            </div>
          </div>
        </div>

        {/* CONTACTS */}
        {contacts.length > 0 && (
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-bold text-lt-fg">People on this thread ({contactsIncluded} of {contacts.length} selected)</h2>
              <p className="text-[11px] text-lt-fg3">Will attach to the new job on save</p>
            </div>
            <div className="space-y-1.5">
              {contacts.map((c, idx) => (
                <div
                  key={`${c.email}-${idx}`}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border text-[12px] ${c.include ? 'bg-lt-card border-lt-hairline' : 'bg-lt-inner/40 border-lt-hairline opacity-70'}`}
                >
                  <input
                    type="checkbox"
                    checked={c.include}
                    onChange={(e) => toggleContact(idx, e.target.checked)}
                    aria-label={`Include ${c.name || c.email}`}
                  />
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded border ${
                    c.match_status === 'existing' ? 'bg-chip-good-bg text-chip-good-fg border-chip-good-fg/30'
                      : c.match_status === 'possible_match' ? 'bg-chip-warn-bg text-chip-warn-fg border-chip-warn-fg/30'
                      : 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-neutral-fg/30'
                  }`}>
                    {c.match_status === 'existing' ? '✓' : c.match_status === 'possible_match' ? '?' : '+'}
                  </span>
                  <span className="font-semibold text-lt-fg truncate">{c.name || c.email}</span>
                  <span className="text-lt-fg3 truncate">· {c.email}</span>
                  <select
                    value={c.role}
                    onChange={(e) => setContactRole(idx, e.target.value as SuggestedJobRole)}
                    className="ml-auto px-1.5 py-0.5 bg-lt-inner border border-lt-hairline rounded text-[11px] text-lt-fg"
                  >
                    {JOB_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LINE ITEMS preview (presentation-only; remove allowed) */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-bold text-lt-fg">Line items ({itemsCount})</h2>
            <p className="text-[11px] text-lt-fg3">Edit / re-pick / add on the order detail page after Create</p>
          </div>
          {itemsCount === 0 ? (
            <div className="text-xs text-lt-fg3 text-center py-4">
              No parsed line items. Create the draft and add items on the next page.
            </div>
          ) : (
            <div className="divide-y divide-lt-hairline/60">
              {items.map((it, idx) => (
                <div key={idx} className="py-1.5 grid grid-cols-[40px_1fr_60px_90px_90px_90px_36px] gap-2 items-start text-xs">
                  <span className="font-mono tabular-nums text-lt-fg">{it.quantity}</span>
                  <div className="min-w-0">
                    <div className="text-lt-fg truncate">{it.description}</div>
                    {it.qualifier && <div className="text-lt-fg3 italic truncate">— {it.qualifier}</div>}
                    {it.warnings && it.warnings.length > 0 && (
                      <div className="text-[10px] text-chip-warn-fg mt-0.5">
                        {it.warnings.join(' · ')}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-lt-fg2">{DEPT_LABEL[it.department]}</span>
                  <span className="text-right font-mono text-lt-fg2">{fmtMoney(Number(it.rate) || 0)}/d</span>
                  <span className="text-[10px] text-lt-fg3">{it.pickupDate}</span>
                  <span className="text-[10px] text-lt-fg3">{it.returnDate}</span>
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="text-lt-fg3 hover:text-chip-bad-fg text-base leading-none"
                    aria-label="Remove line"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* DISCOUNT */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-bold text-lt-fg">Discount (optional)</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-lt-fg3 mb-1">Label</label>
              <input
                type="text"
                value={discountLabel}
                onChange={(e) => setDiscountLabel(e.target.value)}
                placeholder="e.g. Loyalty discount"
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-lt-fg3 mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder="500.00"
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg font-mono"
              />
            </div>
          </div>
        </div>

        {/* SUBMIT */}
        {createError && (
          <div className="bg-chip-bad-bg/30 border border-chip-bad-fg/40 text-chip-bad-fg rounded px-3 py-2 text-sm">
            {createError}
          </div>
        )}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-lt-fg3">
            {canCreate
              ? 'Ready — creates a DRAFT order and opens it for editing.'
              : 'Pick a Client Company and a Job to enable.'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push('/orders')}
              className="px-4 py-2 text-sm text-lt-fg2 hover:text-lt-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createDraft}
              disabled={!canCreate}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-bold rounded-lg"
            >
              {creating ? 'Creating…' : 'Create draft & open →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
