'use client'

/**
 * Insurance Claim detail page. Sits at /claims/[id].
 *
 * Three panels:
 *   1. Header: number + status pill + carrier + asset/booking/invoice
 *      links. Status dropdown drives the PATCH endpoint and the
 *      server stamps submittedAt/settledAt automatically on the
 *      relevant transitions + appends a ClaimTimeline row.
 *   2. Financials: editable money fields (estimate, actual, demand,
 *      offered, settled, daysOOS, daily rate, loss-of-revenue).
 *      Save fires one PATCH with only the changed fields.
 *   3. Adjuster + notes: free-text fields, same save path.
 *   4. Timeline: read of every ClaimTimeline row + an append form
 *      for free-text notes (action defaults to NEGOTIATION_NOTE).
 *
 * Loading and save state are inline; no global toast in this app.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { ClaimBadge } from '@/lib/claims/claimBadges'

type ClaimStatus =
  | 'DRAFT' | 'READY_TO_SEND' | 'SUBMITTED' | 'ACKNOWLEDGED'
  | 'NEGOTIATING' | 'SETTLED' | 'DENIED' | 'ESCALATED' | 'CLOSED'

const STATUS_ORDER: ClaimStatus[] = [
  'DRAFT', 'READY_TO_SEND', 'SUBMITTED', 'ACKNOWLEDGED',
  'NEGOTIATING', 'SETTLED', 'DENIED', 'ESCALATED', 'CLOSED',
]
const STATUS_TONE: Record<ClaimStatus, string> = {
  DRAFT:         'bg-chip-neutral-bg text-chip-neutral-fg',
  READY_TO_SEND: 'bg-cadence-booked-bg text-cadence-booked-fg',
  SUBMITTED:     'bg-cadence-on-rental-bg text-cadence-on-rental-fg',
  ACKNOWLEDGED:  'bg-cadence-on-rental-bg text-cadence-on-rental-fg',
  NEGOTIATING:   'bg-chip-warn-bg text-chip-warn-fg',
  SETTLED:       'bg-chip-good-bg text-chip-good-fg',
  CLOSED:        'bg-chip-neutral-bg text-chip-neutral-fg',
  DENIED:        'bg-chip-bad-bg text-chip-bad-fg',
  ESCALATED:     'bg-chip-bad-bg text-chip-bad-fg',
}
const BADGE_TONE: Record<ClaimBadge, string> = {
  ESCALATED:          'bg-chip-bad-bg text-chip-bad-fg',
  OVERDUE_RESPONSE:   'bg-chip-bad-bg text-chip-bad-fg',
  LD_INVOICE_OVERDUE: 'bg-chip-bad-bg text-chip-bad-fg',
  HIGH_EXPOSURE:      'bg-chip-warn-bg text-chip-warn-fg',
  GONE_QUIET:         'bg-chip-warn-bg text-chip-warn-fg',
  STALE_NEGOTIATING:  'bg-chip-warn-bg text-chip-warn-fg',
  MISSING_COI:        'bg-chip-neutral-bg text-chip-neutral-fg',
}
const BADGE_LABEL: Record<ClaimBadge, string> = {
  ESCALATED:          'Escalated',
  OVERDUE_RESPONSE:   'Overdue',
  LD_INVOICE_OVERDUE: 'LD past-due',
  HIGH_EXPOSURE:      'High exposure',
  GONE_QUIET:         'Quiet',
  STALE_NEGOTIATING:  'Stale',
  MISSING_COI:        'No COI',
}

const STATUS_LABEL: Record<ClaimStatus, string> = {
  DRAFT:         'Draft',
  READY_TO_SEND: 'Ready to send',
  SUBMITTED:     'Submitted',
  ACKNOWLEDGED:  'Acknowledged',
  NEGOTIATING:   'Negotiating',
  SETTLED:       'Settled',
  DENIED:        'Denied',
  ESCALATED:     'Escalated',
  CLOSED:        'Closed',
}

interface ClaimDetail {
  id: string
  claimNumber: string
  status: ClaimStatus
  filedAgainst: string
  adjusterName: string | null
  adjusterPhone: string | null
  adjusterEmail: string | null
  policyNumber: string | null
  carrierClaimNumber: string | null
  incidentDate: string
  incidentDescription: string
  repairEstimate: number | null
  repairActual: number | null
  repairVendor: string | null
  daysOutOfService: number | null
  dailyRevenueRate: number | null
  lossOfRevenue: number | null
  totalDemand: number | null
  amountOffered: number | null
  amountSettled: number | null
  // Phase A ledger
  lossAmount: number | null
  contractAmount: number | null
  acvReceived: number | null
  depreciationApplied: number | null
  deductibleAmount: number | null
  adminFeeAmount: number | null
  // Phase A follow-up cadence
  nextActionAt: string | null
  lastContactAt: string | null
  notes: string | null
  submittedAt: string | null
  settledAt: string | null
  createdAt: string
  updatedAt: string
  company: { id: string; name: string }
  asset: {
    id: string; unitName: string; year: number | null; make: string | null;
    model: string | null; vin: string | null; licensePlate: string | null;
    category: { id: string; name: string; slug: string } | null
  } | null
  booking: {
    id: string; bookingNumber: string; jobName: string;
    productionName: string | null; startDate: string | null; endDate: string | null
  } | null
  invoice: {
    id: string; invoiceNumber: string; type: string; status: string;
    total: number; amountPaid: number; balanceDue: number;
    dueDate: string | null; sentAt: string | null; paidAt: string | null;
    order: {
      id: string; orderNumber: string; jobContactId: string | null;
      jobContact: { id: string; firstName: string; lastName: string; email: string; phone: string | null; mobile: string | null } | null;
      job: {
        id: string; jobCode: string; name: string;
        jobContacts: { role: string; isPrimary: boolean;
          person: { id: string; firstName: string; lastName: string; email: string; phone: string | null }
        }[]
      } | null;
    } | null
  } | null
  // Server-composed two-payer ledger view — the math lives in the
  // GET handler so client renders never disagree.
  ledger: {
    contractBilled: number | null
    contractPaid: number | null
    contractBalanceDue: number | null
    contractFromOnboardingField: boolean
    insuranceSettledGross: number | null
    insuranceSettledNetOfDeductible: number | null
    deductibleApplied: number | null
    clientExposure: number | null
  }
  // Phase A — server-computed badge facts.
  badges: ClaimBadge[]
  coiCheck: { id: string; fileUrl: string; aiRiskLevel: string | null; policyExpiryDate: string | null } | null
  assignedToUser: { id: string; name: string; email: string } | null
  damageItems: {
    id: string; locationOnVehicle: string; damageType: string; severity: string;
    estimatedRepairCost: number | null; disposition: string; photoUrl: string | null;
    inspection: { type: string; inspectionDate: string } | null
  }[]
  timeline: {
    id: string; action: string; description: string; amount: number | null;
    isAi: boolean; createdAt: string; performedByUser: { id: string; name: string } | null
  }[]
  documents: { id: string; type: string; title: string; fileUrl: string; notes: string | null; createdAt: string }[]
}

const fmtMoney = (n: number | null): string => {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}
const fmtDate = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const fmtDateTime = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Local edit-form state. We keep money fields as strings so an
// empty input stays empty (vs being coerced to 0) and so partial
// typing like "12." doesn't get clobbered by Number(). The PATCH
// only sends the fields that actually changed.
type EditForm = {
  status: ClaimStatus
  filedAgainst: string
  adjusterName: string
  adjusterPhone: string
  adjusterEmail: string
  policyNumber: string
  carrierClaimNumber: string
  repairEstimate: string
  repairActual: string
  repairVendor: string
  daysOutOfService: string
  dailyRevenueRate: string
  lossOfRevenue: string
  totalDemand: string
  amountOffered: string
  amountSettled: string
  // Phase A ledger
  lossAmount: string
  contractAmount: string
  acvReceived: string
  depreciationApplied: string
  deductibleAmount: string
  adminFeeAmount: string
  // Phase A follow-up — captured as YYYY-MM-DD via <input type="date">
  nextActionAt: string
  lastContactAt: string
  notes: string
}
// ISO datetime → YYYY-MM-DD for the date input. Empty string when
// null so the input stays blank rather than rendering Invalid Date.
function ymd(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}
function formFromClaim(c: ClaimDetail): EditForm {
  return {
    status: c.status,
    filedAgainst: c.filedAgainst || '',
    adjusterName: c.adjusterName ?? '',
    adjusterPhone: c.adjusterPhone ?? '',
    adjusterEmail: c.adjusterEmail ?? '',
    policyNumber: c.policyNumber ?? '',
    carrierClaimNumber: c.carrierClaimNumber ?? '',
    repairEstimate: c.repairEstimate == null ? '' : String(c.repairEstimate),
    repairActual: c.repairActual == null ? '' : String(c.repairActual),
    repairVendor: c.repairVendor ?? '',
    daysOutOfService: c.daysOutOfService == null ? '' : String(c.daysOutOfService),
    dailyRevenueRate: c.dailyRevenueRate == null ? '' : String(c.dailyRevenueRate),
    lossOfRevenue: c.lossOfRevenue == null ? '' : String(c.lossOfRevenue),
    totalDemand: c.totalDemand == null ? '' : String(c.totalDemand),
    amountOffered: c.amountOffered == null ? '' : String(c.amountOffered),
    amountSettled: c.amountSettled == null ? '' : String(c.amountSettled),
    lossAmount: c.lossAmount == null ? '' : String(c.lossAmount),
    contractAmount: c.contractAmount == null ? '' : String(c.contractAmount),
    acvReceived: c.acvReceived == null ? '' : String(c.acvReceived),
    depreciationApplied: c.depreciationApplied == null ? '' : String(c.depreciationApplied),
    deductibleAmount: c.deductibleAmount == null ? '' : String(c.deductibleAmount),
    adminFeeAmount: c.adminFeeAmount == null ? '' : String(c.adminFeeAmount),
    nextActionAt: ymd(c.nextActionAt),
    lastContactAt: ymd(c.lastContactAt),
    notes: c.notes ?? '',
  }
}
// Build the PATCH body containing ONLY the fields that diverged
// from the server's last-known state. Empty strings on money fields
// translate to null (clear the field); the API treats null as
// "unset this column."
function diffPatch(prev: EditForm, next: EditForm): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (prev.status !== next.status) out.status = next.status
  const strFields = ['filedAgainst','adjusterName','adjusterPhone','adjusterEmail','policyNumber','carrierClaimNumber','repairVendor','notes'] as const
  for (const k of strFields) {
    if (prev[k] !== next[k]) out[k] = next[k] === '' ? null : next[k]
  }
  const numFields = [
    'repairEstimate','repairActual','daysOutOfService','dailyRevenueRate','lossOfRevenue',
    'totalDemand','amountOffered','amountSettled',
    'lossAmount','contractAmount','acvReceived','depreciationApplied','deductibleAmount','adminFeeAmount',
  ] as const
  for (const k of numFields) {
    if (prev[k] !== next[k]) out[k] = next[k] === '' ? null : Number(next[k])
  }
  // Date fields — the input gives us YYYY-MM-DD; pass through as
  // string (server parses) or null on clear.
  const dateFields = ['nextActionAt','lastContactAt'] as const
  for (const k of dateFields) {
    if (prev[k] !== next[k]) out[k] = next[k] === '' ? null : next[k]
  }
  return out
}

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''

  const [claim, setClaim] = useState<ClaimDetail | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)
  const [original, setOriginal] = useState<EditForm | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // Timeline append state
  const [noteText, setNoteText] = useState('')
  const [noteAmount, setNoteAmount] = useState('')
  const [noteAction, setNoteAction] = useState('NEGOTIATION_NOTE')
  const [noteSaving, setNoteSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadErr(null)
    try {
      const res = await fetch(`/api/claims/${id}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setLoadErr(data?.error || `HTTP ${res.status}`)
        setClaim(null)
        return
      }
      const data = await res.json()
      setClaim(data.claim)
      const f = formFromClaim(data.claim)
      setForm(f)
      setOriginal(f)
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [id])

  useEffect(() => { if (id) load() }, [id, load])

  const save = async () => {
    if (!form || !original) return
    const patch = diffPatch(original, form)
    if (Object.keys(patch).length === 0) {
      setSaveMsg('Nothing changed.')
      setTimeout(() => setSaveMsg(null), 1500)
      return
    }
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch(`/api/claims/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setSaveMsg(data?.error || `Save failed (HTTP ${res.status})`)
        return
      }
      setSaveMsg('Saved.')
      await load()
      setTimeout(() => setSaveMsg(null), 1500)
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const appendNote = async () => {
    if (!noteText.trim() || noteSaving) return
    setNoteSaving(true)
    try {
      const res = await fetch(`/api/claims/${id}/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: noteAction,
          description: noteText.trim(),
          amount: noteAmount.trim() === '' ? null : Number(noteAmount),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        alert(data?.error || `Failed to log (HTTP ${res.status})`)
        return
      }
      setNoteText('')
      setNoteAmount('')
      setNoteAction('NEGOTIATION_NOTE')
      await load()
    } finally {
      setNoteSaving(false)
    }
  }

  if (loadErr) {
    return (
      <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
        <div className="max-w-3xl mx-auto">
          <Link href="/claims" className="text-sm text-lt-fg2 hover:text-lt-fg">← Back to claims</Link>
          <div className="mt-6 rounded-xl border border-chip-bad-fg/30 bg-chip-bad-bg/30 text-chip-bad-fg px-4 py-3">{loadErr}</div>
        </div>
      </div>
    )
  }
  if (!claim || !form) {
    return (
      <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
        <div className="max-w-3xl mx-auto text-lt-fg3 text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1100px] mx-auto">
        <Link href="/claims" className="text-sm text-lt-fg2 hover:text-lt-fg">← Back to claims</Link>

        {/* Header */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 mt-4 mb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold text-lt-fg font-mono tracking-tight">{claim.claimNumber}</h1>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_TONE[claim.status]}`}>
                  {STATUS_LABEL[claim.status]}
                </span>
                {claim.badges.map((b) => (
                  <span
                    key={b}
                    className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${BADGE_TONE[b]}`}
                  >
                    {BADGE_LABEL[b]}
                  </span>
                ))}
              </div>
              <div className="text-sm text-lt-fg2 mt-1">
                {claim.filedAgainst}
                {claim.carrierClaimNumber && (
                  <span className="text-lt-fg3"> · carrier # <span className="font-mono text-lt-fg2">{claim.carrierClaimNumber}</span></span>
                )}
                {claim.policyNumber && <span className="text-lt-fg3"> · policy {claim.policyNumber}</span>}
              </div>
              <div className="text-xs text-lt-fg3 mt-1">
                Incident {fmtDate(claim.incidentDate)} · opened {fmtDate(claim.createdAt)}
                {claim.submittedAt && <> · submitted {fmtDate(claim.submittedAt)}</>}
                {claim.settledAt && <> · settled {fmtDate(claim.settledAt)}</>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ClaimStatus })}
                className="px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="px-4 py-2 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white text-sm font-medium rounded-lg"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saveMsg && <span className="text-xs text-lt-fg3">{saveMsg}</span>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* LEFT 2/3 — financials + adjuster + notes */}
          <div className="md:col-span-2 space-y-5">
            {/* Financials */}
            <Section title="Financials">
              <div className="grid grid-cols-2 gap-4">
                <Money label="Repair estimate"   value={form.repairEstimate}   onChange={(v) => setForm({ ...form, repairEstimate: v })} />
                <Money label="Repair actual"     value={form.repairActual}     onChange={(v) => setForm({ ...form, repairActual: v })} />
                <Text  label="Repair vendor"     value={form.repairVendor}     onChange={(v) => setForm({ ...form, repairVendor: v })} />
                <Int   label="Days out of service" value={form.daysOutOfService} onChange={(v) => setForm({ ...form, daysOutOfService: v })} />
                <Money label="Daily revenue rate" value={form.dailyRevenueRate} onChange={(v) => setForm({ ...form, dailyRevenueRate: v })} />
                <Money label="Loss of revenue"   value={form.lossOfRevenue}    onChange={(v) => setForm({ ...form, lossOfRevenue: v })} />
                <Money label="Total demand"      value={form.totalDemand}      onChange={(v) => setForm({ ...form, totalDemand: v })} />
                <Money label="Amount offered"    value={form.amountOffered}    onChange={(v) => setForm({ ...form, amountOffered: v })} />
                <Money label="Amount settled"    value={form.amountSettled}    onChange={(v) => setForm({ ...form, amountSettled: v })} />
              </div>
            </Section>

            {/* Adjuster + notes */}
            <Section title="Adjuster">
              <div className="grid grid-cols-2 gap-4">
                <Text  label="Carrier"        value={form.filedAgainst}  onChange={(v) => setForm({ ...form, filedAgainst: v })} />
                <Text  label="Carrier claim #" value={form.carrierClaimNumber} onChange={(v) => setForm({ ...form, carrierClaimNumber: v })} />
                <Text  label="Policy number"  value={form.policyNumber}  onChange={(v) => setForm({ ...form, policyNumber: v })} />
                <Text  label="Adjuster name"  value={form.adjusterName}  onChange={(v) => setForm({ ...form, adjusterName: v })} />
                <Text  label="Adjuster phone" value={form.adjusterPhone} onChange={(v) => setForm({ ...form, adjusterPhone: v })} />
                <Text  label="Adjuster email" value={form.adjusterEmail} onChange={(v) => setForm({ ...form, adjusterEmail: v })} />
              </div>
              <p className="text-[11px] text-lt-fg3 mt-2">
                Carrier claim # is the insurer&apos;s own reference (e.g. Intact &quot;0AB459860&quot;) — distinct from
                SR-CLM and from the renter&apos;s policy. The future email scanner uses it as a join key to attach
                inbound adjuster mail to this record.
              </p>
            </Section>

            <Section title="Follow-up">
              <div className="grid grid-cols-2 gap-4">
                <DateInput label="Next action due"
                  value={form.nextActionAt}
                  onChange={(v) => setForm({ ...form, nextActionAt: v })} />
                <DateInput label="Last contact"
                  value={form.lastContactAt}
                  onChange={(v) => setForm({ ...form, lastContactAt: v })} />
              </div>
              <p className="text-[11px] text-lt-fg3 mt-2">
                Drives the OVERDUE_RESPONSE and GONE_QUIET badges on the claims list.
              </p>
            </Section>

            <Section title="Internal notes">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={5}
                placeholder="Private context — not visible to the carrier."
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg focus:outline-none focus:border-lt-fg2"
              />
            </Section>
          </div>

          {/* RIGHT 1/3 — ledger + context + timeline */}
          <div className="md:col-span-1 space-y-5">
            <LedgerPanel claim={claim} form={form} setForm={setForm} />
            <RenterContactPanel claim={claim} />

            <Section title="Context">
              <Field label="Client">
                <Link href={`/crm/${claim.company.id}`} className="text-lt-fg hover:text-black underline-offset-2 hover:underline">
                  {claim.company.name}
                </Link>
              </Field>
              {claim.asset && (
                <Field label="Asset">
                  <div className="text-lt-fg">{claim.asset.unitName}</div>
                  <div className="text-xs text-lt-fg3">
                    {[claim.asset.year, claim.asset.make, claim.asset.model].filter(Boolean).join(' ')}
                    {claim.asset.category?.name ? ` · ${claim.asset.category.name}` : ''}
                  </div>
                  {(claim.asset.vin || claim.asset.licensePlate) && (
                    <div className="text-[11px] text-lt-fg3 font-mono mt-0.5">
                      {claim.asset.vin && <span>VIN {claim.asset.vin}</span>}
                      {claim.asset.vin && claim.asset.licensePlate && <span> · </span>}
                      {claim.asset.licensePlate && <span>{claim.asset.licensePlate}</span>}
                    </div>
                  )}
                </Field>
              )}
              {claim.booking && (
                <Field label="Booking">
                  <span className="font-mono text-xs">{claim.booking.bookingNumber}</span>
                  <div className="text-xs text-lt-fg3">{claim.booking.jobName}</div>
                  <div className="text-[11px] text-lt-fg3">
                    {fmtDate(claim.booking.startDate)} → {fmtDate(claim.booking.endDate)}
                  </div>
                </Field>
              )}
              {claim.invoice && (
                <Field label="LD invoice">
                  <span className="font-mono text-xs">{claim.invoice.invoiceNumber}</span>
                  <span className="text-[10px] uppercase tracking-wider text-lt-fg3 ml-2">{claim.invoice.type}</span>
                  <div className="text-xs text-lt-fg3 mt-0.5">
                    Total {fmtMoney(claim.invoice.total)} · paid {fmtMoney(claim.invoice.amountPaid)} · due {fmtMoney(claim.invoice.balanceDue)}
                  </div>
                  {claim.invoice.order && (
                    <div className="text-[11px] text-lt-fg3">
                      Order{' '}
                      <Link href={`/orders/${claim.invoice.order.id}`} className="font-mono text-lt-fg2 hover:text-lt-fg">
                        {claim.invoice.order.orderNumber}
                      </Link>
                    </div>
                  )}
                </Field>
              )}
              {claim.coiCheck && (
                <Field label="COI on file">
                  <a href={claim.coiCheck.fileUrl} target="_blank" rel="noreferrer" className="text-lt-fg hover:text-black underline-offset-2 hover:underline">
                    Open ↗
                  </a>
                  {claim.coiCheck.aiRiskLevel && <span className="text-[10px] uppercase tracking-wider text-lt-fg3 ml-2">{claim.coiCheck.aiRiskLevel} risk</span>}
                  {claim.coiCheck.policyExpiryDate && (
                    <div className="text-[11px] text-lt-fg3">Expires {fmtDate(claim.coiCheck.policyExpiryDate)}</div>
                  )}
                </Field>
              )}
              {claim.assignedToUser ? (
                <Field label="Assignee">
                  <div className="text-lt-fg">{claim.assignedToUser.name}</div>
                  <div className="text-[11px] text-lt-fg3">{claim.assignedToUser.email}</div>
                </Field>
              ) : (
                <Field label="Assignee"><span className="text-lt-fg3">Unassigned</span></Field>
              )}
            </Section>

            <Section title="Incident">
              <p className="text-xs text-lt-fg2 whitespace-pre-wrap">{claim.incidentDescription}</p>
            </Section>

            {claim.damageItems.length > 0 && (
              <Section title={`Damage items (${claim.damageItems.length})`}>
                <ul className="space-y-2">
                  {claim.damageItems.map((d) => (
                    <li key={d.id} className="text-xs">
                      <div className="text-lt-fg">{d.locationOnVehicle}</div>
                      <div className="text-[11px] text-lt-fg3">
                        {d.damageType} · {d.severity} · est {fmtMoney(d.estimatedRepairCost)}{' '}
                        <span className="uppercase tracking-wider">· {d.disposition}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {claim.documents.length > 0 && (
              <Section title={`Documents (${claim.documents.length})`}>
                <ul className="space-y-1.5">
                  {claim.documents.map((doc) => (
                    <li key={doc.id} className="text-xs">
                      <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-lt-fg hover:text-black underline-offset-2 hover:underline">
                        {doc.title}
                      </a>
                      <span className="text-[10px] uppercase tracking-wider text-lt-fg3 ml-2">{doc.type}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Timeline */}
            <Section title="Timeline">
              {/* Append form */}
              <div className="mb-3 rounded-lg border border-lt-hairline bg-lt-inner p-3 space-y-2">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={2}
                  placeholder="Log a note (or counter-sent, document-added, etc.)"
                  className="w-full rounded-lg border border-lt-hairline bg-lt-card px-3 py-2 text-xs text-lt-fg focus:outline-none focus:border-lt-fg2"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={noteAction}
                    onChange={(e) => setNoteAction(e.target.value)}
                    className="px-2 py-1 text-[11px] bg-lt-card border border-lt-hairline rounded text-lt-fg2"
                  >
                    <option value="NEGOTIATION_NOTE">Note</option>
                    <option value="COUNTER_SENT">Counter sent</option>
                    <option value="OFFER_RECEIVED">Offer received</option>
                    <option value="ADJUSTER_ASSIGNED">Adjuster assigned</option>
                    <option value="DOCUMENT_ADDED">Document added</option>
                  </select>
                  <input
                    type="number"
                    value={noteAmount}
                    onChange={(e) => setNoteAmount(e.target.value)}
                    placeholder="$ (optional)"
                    className="w-24 px-2 py-1 text-[11px] bg-lt-card border border-lt-hairline rounded text-lt-fg"
                  />
                  <button
                    type="button"
                    onClick={appendNote}
                    disabled={!noteText.trim() || noteSaving}
                    className="ml-auto text-[11px] font-semibold bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white px-3 py-1 rounded"
                  >
                    {noteSaving ? '…' : 'Log'}
                  </button>
                </div>
              </div>

              {claim.timeline.length === 0 ? (
                <p className="text-xs text-lt-fg3">No timeline entries yet.</p>
              ) : (
                <ul className="space-y-2">
                  {claim.timeline.map((t) => (
                    <li key={t.id} className="text-xs border-b border-lt-hairline/50 pb-2 last:border-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-lt-fg3">
                          {t.action.replace(/_/g, ' ')}
                        </span>
                        {t.amount != null && (
                          <span className="font-mono text-lt-fg">{fmtMoney(t.amount)}</span>
                        )}
                        <span className="ml-auto text-[10px] text-lt-fg3">
                          {fmtDateTime(t.createdAt)}
                          {t.performedByUser && <> · {t.performedByUser.name}</>}
                          {t.isAi && <> · AI</>}
                        </span>
                      </div>
                      <p className="text-xs text-lt-fg2 mt-0.5 whitespace-pre-wrap">{t.description}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Small helpers ──────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
      <h2 className="text-[11px] uppercase tracking-wider font-semibold text-lt-fg3 mb-3">{title}</h2>
      {children}
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[10px] uppercase tracking-wider text-lt-fg3 mb-0.5">{label}</div>
      <div className="text-sm text-lt-fg">{children}</div>
    </div>
  )
}
function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-lt-fg3">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg focus:outline-none focus:border-lt-fg2"
      />
    </label>
  )
}
function Money({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-lt-fg3">{label}</span>
      <div className="mt-0.5 flex items-center rounded-lg border border-lt-hairline bg-lt-inner focus-within:border-lt-fg2">
        <span className="pl-3 text-lt-fg3 text-sm">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent px-2 py-2 text-sm text-lt-fg font-mono focus:outline-none"
          placeholder="0.00"
        />
      </div>
    </label>
  )
}
function Int({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-lt-fg3">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg font-mono focus:outline-none focus:border-lt-fg2"
      />
    </label>
  )
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-lt-fg3">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg focus:outline-none focus:border-lt-fg2"
      />
    </label>
  )
}

// ─── Ledger panel — contract side vs insurance side + client exposure ──

function LedgerPanel({
  claim,
  form,
  setForm,
}: {
  claim: ClaimDetail
  form: EditForm
  setForm: (f: EditForm) => void
}) {
  const L = claim.ledger
  const hasContract = L.contractBilled != null

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
      <h2 className="text-[11px] uppercase tracking-wider font-semibold text-lt-fg3 mb-3">
        Contract vs insurance — client exposure
      </h2>

      {/* Client exposure — the goal metric. Prominent treatment so a
          rep glancing at the right rail knows immediately what the
          client owes us once the carrier pays out. */}
      <div className="mb-4 rounded-lg border border-chip-warn-fg/30 bg-chip-warn-bg/40 p-3">
        <div className="text-[10px] uppercase tracking-wider text-chip-warn-fg font-semibold">
          Client exposure
        </div>
        <div className="text-2xl font-semibold font-mono text-chip-warn-fg mt-0.5">
          {L.clientExposure == null ? '—' : fmtMoney(L.clientExposure)}
        </div>
        <div className="text-[11px] text-lt-fg3 mt-0.5">
          {hasContract
            ? `LD balance ${fmtMoney(L.contractBalanceDue)} − net settlement ${fmtMoney(L.insuranceSettledNetOfDeductible ?? 0)}`
            : 'No LD invoice linked — exposure isn’t computable until billing is in place.'}
        </div>
      </div>

      {/* Two-payer split */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Contract side */}
        <div className="rounded-lg border border-lt-hairline p-3">
          <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">
            Contract side
          </div>
          {L.contractFromOnboardingField ? (
            <>
              <div className="text-[10px] text-lt-fg3 mt-1 italic">Estimated · no LD invoice yet</div>
              <Row label="Billed (snap)" value={fmtMoney(L.contractBilled)} bold />
            </>
          ) : hasContract ? (
            <>
              <Row label="Billed (LD)" value={fmtMoney(L.contractBilled)} />
              <Row label="Paid"        value={fmtMoney(L.contractPaid)} />
              <Row label="Balance due" value={fmtMoney(L.contractBalanceDue)} bold />
            </>
          ) : (
            <div className="text-[11px] text-lt-fg3 mt-1">No LD invoice and no contract snapshot.</div>
          )}
        </div>
        {/* Insurance side */}
        <div className="rounded-lg border border-lt-hairline p-3">
          <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">
            Insurance side
          </div>
          <Row label="Loss"          value={fmtMoney(claim.lossAmount)} />
          <Row label="ACV recvd"     value={fmtMoney(claim.acvReceived)} />
          <Row label="Depreciation"  value={fmtMoney(claim.depreciationApplied)} />
          <Row label="Offered"       value={fmtMoney(claim.amountOffered)} />
          <Row label="Settled (gr)"  value={fmtMoney(L.insuranceSettledGross)} bold />
          <Row label="Deductible"    value={fmtMoney(L.deductibleApplied)} />
          <Row label="Net to us"     value={fmtMoney(L.insuranceSettledNetOfDeductible)} />
        </div>
      </div>

      {/* Inline-editable money fields — flows through the same
          diff-PATCH save the rest of the form uses. */}
      <div className="grid grid-cols-2 gap-3">
        <Money label="Loss amount"        value={form.lossAmount}          onChange={(v) => setForm({ ...form, lossAmount: v })} />
        <Money label="Contract billed"    value={form.contractAmount}      onChange={(v) => setForm({ ...form, contractAmount: v })} />
        <Money label="ACV received"       value={form.acvReceived}         onChange={(v) => setForm({ ...form, acvReceived: v })} />
        <Money label="Depreciation"       value={form.depreciationApplied} onChange={(v) => setForm({ ...form, depreciationApplied: v })} />
        <Money label="Deductible"         value={form.deductibleAmount}    onChange={(v) => setForm({ ...form, deductibleAmount: v })} />
        <Money label="Admin fee (10%)"    value={form.adminFeeAmount}      onChange={(v) => setForm({ ...form, adminFeeAmount: v })} />
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between mt-1.5 text-xs">
      <span className="text-lt-fg3">{label}</span>
      <span className={`font-mono ${bold ? 'text-lt-fg font-semibold' : 'text-lt-fg2'}`}>{value}</span>
    </div>
  )
}

// ─── Renter contact — "who do I call at the renter?" ─────────────

function RenterContactPanel({ claim }: { claim: ClaimDetail }) {
  // Resolution waterfall, mirroring how the order detail picks a
  // primary contact: order.jobContact (the on-order primary) → first
  // jobContact marked isPrimary → first jobContact by role. When the
  // claim has no LD invoice (onboarded), there's nothing to walk —
  // surface the company name only and prompt the rep to add a contact.
  const order = claim.invoice?.order ?? null
  const direct = order?.jobContact ?? null
  const fromRoster = !direct && order?.job?.jobContacts && order.job.jobContacts.length > 0
    ? (order.job.jobContacts.find((c) => c.isPrimary) ?? order.job.jobContacts[0])
    : null
  const contact = direct
    ? { id: direct.id, firstName: direct.firstName, lastName: direct.lastName, email: direct.email, phone: direct.phone, role: 'PRIMARY' }
    : fromRoster
      ? { id: fromRoster.person.id, firstName: fromRoster.person.firstName, lastName: fromRoster.person.lastName, email: fromRoster.person.email, phone: fromRoster.person.phone, role: fromRoster.role }
      : null

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
      <h2 className="text-[11px] uppercase tracking-wider font-semibold text-lt-fg3 mb-3">
        Renter contact
      </h2>
      <div className="text-sm text-lt-fg font-semibold">{claim.company.name}</div>
      {contact ? (
        <div className="mt-2 space-y-0.5">
          <div className="text-sm text-lt-fg">
            {contact.firstName} {contact.lastName}{' '}
            <span className="text-[10px] uppercase tracking-wider text-lt-fg3">· {contact.role.replace('_', ' ')}</span>
          </div>
          {contact.email && (
            <div className="text-xs text-lt-fg2">
              <a href={`mailto:${contact.email}`} className="hover:text-lt-fg">{contact.email}</a>
            </div>
          )}
          {contact.phone && (
            <div className="text-xs text-lt-fg2">
              <a href={`tel:${contact.phone}`} className="hover:text-lt-fg">{contact.phone}</a>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-lt-fg3 mt-2">
          No contact resolvable from this claim — add a JobContact on the linked job, or attach the claim to an LD invoice.
        </p>
      )}
    </div>
  )
}
