'use client'

/**
 * LdDispositionPanel — Phase 5 commit 4. Order-detail surface for
 * the LD branch: triage return-damage findings into bill-now /
 * send-to-LD / waived, then spin up the LD invoice.
 *
 * Visible when the order is RETURNED, LD_CHECK, INVOICED, or CLOSED
 * (closed-with-open-LD is reachable per the doctrine — operators
 * may still triage damage post-close).
 *
 * Read source: GET /api/orders/[id]/return-damage. Writes go through
 * POST /api/orders/[id]/return-damage (new damage), PATCH
 * /api/damages/[id] (disposition change), POST /api/orders/[id]/
 * ld-invoices (LD invoice generation).
 *
 * Claim opening on a generated LD invoice is surfaced inside the
 * existing Invoices block — the operator clicks "Open claim" next
 * to the LD invoice row.
 *
 * ── Gear, not just vehicles (2026-09-18) ──────────────────────────
 *
 * Wes, relaying Ana: *"the only thing I see on the L&D portion is for
 * vehicle damage."* True, and it made this panel useless for most of
 * the L&D on this yard, which is gear — a light back broken, three
 * stingers that never came back at all. That lives on the warehouse's
 * check-in sheet as `actualQty < expectedQty`, and a DamageItem is
 * vehicle-scoped (`locationOnVehicle`, inspection → asset), so a short
 * case has no row to show here and the panel rendered empty.
 *
 * So the panel now reads GET /api/orders/[id]/ld-invoices — the
 * composer's own candidate list, which covers BOTH halves — for its
 * summary line, and its billing button opens that composer instead of
 * sweeping damage straight onto an invoice. The damage triage below is
 * unchanged; it is the half this screen was always good at.
 *
 * The old "Generate LD invoice" button is gone deliberately. It POSTed
 * an empty body, which bills every SEND_TO_LD finding in one click with
 * nothing reviewed and no gear at all. The composer arrives with
 * everything UNTICKED and priced from `replacementCost`, which is the
 * doctrine the billing desk already works to: a short count is evidence,
 * not a verdict.
 */

import { useCallback, useEffect, useState } from 'react'
import { LdInvoiceModal } from '@/components/collections/LdInvoiceModal'

type Disposition = 'PENDING' | 'BILL_NOW' | 'SEND_TO_LD' | 'WAIVED'
type DamageType = 'SCRATCH' | 'DENT' | 'CRACK' | 'MISSING_PART' | 'MECHANICAL' | 'INTERIOR' | 'OTHER'
type Severity = 'MINOR' | 'MODERATE' | 'MAJOR'

interface DamageRow {
  id: string
  locationOnVehicle: string
  damageType: DamageType
  severity: Severity
  estimatedRepairCost: string | null
  photoUrl: string | null
  notes: string | null
  isPreExisting: boolean
  disposition: Disposition
  invoiceId: string | null
  claimId: string | null
  inspection: {
    id: string
    inspectionDate: string
    asset: { id: string; unitName: string } | null
    bookingAssignment: { id: string } | null
  }
}

interface AssignmentRow {
  id: string
  status: string
  asset: { id: string; unitName: string }
}

const DAMAGE_TYPES: DamageType[] = ['SCRATCH', 'DENT', 'CRACK', 'MISSING_PART', 'MECHANICAL', 'INTERIOR', 'OTHER']
const SEVERITIES: Severity[] = ['MINOR', 'MODERATE', 'MAJOR']
const DISPOSITIONS: Disposition[] = ['PENDING', 'BILL_NOW', 'SEND_TO_LD', 'WAIVED']

const DISP_COLOR: Record<Disposition, string> = {
  PENDING:    'bg-zinc-800 text-zinc-300 border-zinc-700',
  BILL_NOW:   'bg-blue-900/40 text-blue-300 border-blue-800',
  SEND_TO_LD: 'bg-orange-900/40 text-orange-300 border-orange-800',
  WAIVED:     'bg-zinc-900 text-zinc-500 border-zinc-800',
}

const SEV_COLOR: Record<Severity, string> = {
  MINOR:    'text-zinc-400',
  MODERATE: 'text-amber-400',
  MAJOR:    'text-rose-400',
}

/** The composer's candidate list, read only for its shape — what is
 *  billable on this order, from both halves of "loss and damage". */
interface LdSummary {
  candidates: Array<{ source: 'CHECK_IN_SHORT' | 'VEHICLE_DAMAGE'; qty: number }>
  existingLdInvoice: { id: string; invoiceNumber: string; status: string; total: number } | null
  hasCheckInReport: boolean
}

export function LdDispositionPanel({
  orderId,
  orderNumber,
  onChanged,
}: {
  orderId: string
  orderNumber: string
  onChanged?: () => void
}) {
  const [damages, setDamages] = useState<DamageRow[] | null>(null)
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [ld, setLd] = useState<LdSummary | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/orders/${orderId}/return-damage`, { cache: 'no-store' })
    if (!r.ok) {
      setErr(`HTTP ${r.status}`)
      setDamages([])
      return
    }
    const data = await r.json()
    setDamages(data.damages || [])
    setAssignments(data.assignments || [])
    setErr(null)

    // The gear half. A failure here is not worth breaking the damage
    // triage over — the summary line simply goes quiet.
    try {
      const l = await fetch(`/api/orders/${orderId}/ld-invoices`, { cache: 'no-store' })
      setLd(l.ok ? ((await l.json()) as LdSummary) : null)
    } catch {
      setLd(null)
    }
  }, [orderId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const changeDisposition = async (damageId: string, disposition: Disposition) => {
    if (busy) return
    setBusy(`disp:${damageId}`)
    setErr(null)
    try {
      const r = await fetch(`/api/damages/${damageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disposition }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.ok) {
        setErr(data.error || `HTTP ${r.status}`)
        return
      }
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const sendToLdCount = (damages ?? []).filter(
    (d) => d.disposition === 'SEND_TO_LD' && !d.invoiceId,
  ).length
  const pendingCount = (damages ?? []).filter((d) => d.disposition === 'PENDING').length
  const billNowUnbilled = (damages ?? []).filter(
    (d) => d.disposition === 'BILL_NOW' && !d.invoiceId,
  ).length

  // The gear half, off the check-in sheet — the part this panel used to be
  // blind to. `qty` is pieces, not lines: "3 stingers" is the number that
  // matters to whoever has to replace them.
  const shortCandidates = (ld?.candidates ?? []).filter((c) => c.source === 'CHECK_IN_SHORT')
  const missingPieces = shortCandidates.reduce((n, c) => n + c.qty, 0)
  const existingLd = ld?.existingLdInvoice ?? null
  const nothingToBill = (ld?.candidates.length ?? 0) === 0

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Loss & damage</h2>
          <div className="text-xs text-zinc-500 mt-0.5">
            Triage return findings: bill on the rental invoice, send to L&D, or waive.
            {pendingCount > 0 && (
              <span className="text-amber-400"> · {pendingCount} pending triage</span>
            )}
            {billNowUnbilled > 0 && (
              <span className="text-blue-300"> · {billNowUnbilled} bill-now ready</span>
            )}
            {sendToLdCount > 0 && (
              <span className="text-orange-300"> · {sendToLdCount} send-to-L&D ready</span>
            )}
            {/* Gear is most of the L&D here and has no row below — say the
                number, or the panel looks empty while three lights are gone. */}
            {shortCandidates.length > 0 && (
              <span className="text-orange-300">
                {' '}· {missingPieces} piece{missingPieces === 1 ? '' : 's'} short on the check-in
                sheet
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="text-xs font-semibold border border-zinc-700 text-zinc-200 hover:border-zinc-500 px-3 py-1.5 rounded-lg"
          >
            {showAddForm ? 'Cancel' : '+ Damage finding'}
          </button>
          {/* Always offered, even with nothing flagged: a loss the sheet
              never caught is still a loss, and the composer takes a
              hand-written line. Ana's case was the opposite of an empty
              order — she had losses and no door to bill them through. */}
          <button
            onClick={() => setComposerOpen(true)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${
              nothingToBill
                ? 'border border-zinc-700 text-zinc-200 hover:border-zinc-500'
                : 'bg-orange-600 hover:bg-orange-500 text-white'
            }`}
            title="Raise a separate L&D invoice — gear off the check-in sheet as well as vehicle damage. It never holds up the rental invoice."
          >
            Bill L&D
          </button>
        </div>
      </div>

      {/* An L&D invoice already exists: the composer refuses to raise a
          second, so point at the one that is there rather than letting
          somebody find that out from a 409. */}
      {existingLd && (
        <div className="mb-3 rounded-lg border border-orange-900/60 bg-orange-950/30 text-orange-200 text-xs px-3 py-2">
          L&D invoice <b>{existingLd.invoiceNumber}</b> ({existingLd.status.toLowerCase()}) is
          already on this order. Void it before raising another.
        </div>
      )}

      {err && (
        <div className="mb-3 rounded-lg border border-rose-800 bg-rose-950/50 text-rose-200 text-xs px-3 py-2">
          {err}
        </div>
      )}

      {showAddForm && (
        <AddDamageForm
          assignments={assignments}
          onCancel={() => setShowAddForm(false)}
          onSaved={async () => {
            setShowAddForm(false)
            await refresh()
          }}
          onPostFailed={(msg) => setErr(msg)}
          orderId={orderId}
        />
      )}

      {composerOpen && (
        <LdInvoiceModal
          orderId={orderId}
          orderNumber={orderNumber}
          onClose={() => setComposerOpen(false)}
          onCreated={() => {
            void refresh()
            onChanged?.()
          }}
        />
      )}

      {damages === null ? (
        <div className="text-xs text-zinc-500">Loading…</div>
      ) : damages.length === 0 ? (
        <div className="text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-lg px-3 py-4 text-center">
          {/* "No damage findings" is about VEHICLES only. Saying just that
              over a sheet with three pieces missing reads as all-clear,
              which is how the gear half stayed invisible. */}
          No vehicle damage findings.{' '}
          {shortCandidates.length > 0 ? (
            <span className="text-orange-300">
              The check-in sheet is short {missingPieces} piece
              {missingPieces === 1 ? '' : 's'} — bill it with Bill L&D above.
            </span>
          ) : ld && !ld.hasCheckInReport ? (
            <span className="text-zinc-600">
              — and no inbound sheet has been typed in, so nothing has been counted yet.
            </span>
          ) : assignments.length === 0 ? (
            <span className="text-zinc-600">— Assign vehicles to specific assets via /scheduling before capturing damage.</span>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {damages.map((d) => {
            const billed = !!d.invoiceId
            const cost = d.estimatedRepairCost == null ? null : Number(d.estimatedRepairCost)
            return (
              <div
                key={d.id}
                className={`border rounded-lg px-3 py-2.5 ${
                  billed ? 'border-zinc-800 bg-zinc-950 opacity-80' : 'border-zinc-800 bg-zinc-950'
                }`}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${SEV_COLOR[d.severity]} border border-zinc-800`}>
                    {d.severity}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    {d.damageType.replace('_', ' ')}
                  </span>
                  <span className="text-sm text-white">{d.locationOnVehicle}</span>
                  {d.inspection.asset && (
                    <span className="text-[11px] text-zinc-500">on {d.inspection.asset.unitName}</span>
                  )}
                  {cost != null && (
                    <span className="text-sm text-white font-semibold ml-auto">
                      ${cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                  {d.isPreExisting && (
                    <span className="text-[10px] text-zinc-500 italic">pre-existing</span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${DISP_COLOR[d.disposition]}`}>
                    {d.disposition.replace('_', ' ')}
                  </span>
                  {billed ? (
                    <span className="text-[10px] text-zinc-500 italic">billed · cannot retriage</span>
                  ) : (
                    <div className="flex items-center gap-1">
                      {DISPOSITIONS.filter((dd) => dd !== d.disposition).map((dd) => (
                        <button
                          key={dd}
                          onClick={() => changeDisposition(d.id, dd)}
                          disabled={busy != null}
                          className="text-[10px] text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded px-1.5 py-0.5"
                        >
                          → {dd.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  )}
                  {d.notes && (
                    <span className="text-[11px] text-zinc-500 italic ml-auto truncate max-w-[40ch]">
                      {d.notes}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Add-damage form ─────────────────────────────────────────────
function AddDamageForm({
  assignments,
  onCancel,
  onSaved,
  onPostFailed,
  orderId,
}: {
  assignments: AssignmentRow[]
  onCancel: () => void
  onSaved: () => void | Promise<void>
  onPostFailed: (msg: string) => void
  orderId: string
}) {
  const [bookingAssignmentId, setBookingAssignmentId] = useState(assignments[0]?.id ?? '')
  const [location, setLocation] = useState('')
  const [damageType, setDamageType] = useState<DamageType>('SCRATCH')
  const [severity, setSeverity] = useState<Severity>('MINOR')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [isPreExisting, setIsPreExisting] = useState(false)
  const [disposition, setDisposition] = useState<Disposition>('PENDING')
  const [posting, setPosting] = useState(false)

  if (assignments.length === 0) {
    return (
      <div className="mb-3 rounded-lg border border-amber-900/60 bg-amber-950/30 text-amber-200 text-xs px-3 py-2">
        This order has no BookingAssignments yet. Assign specific vehicles via{' '}
        <a className="underline" href="/scheduling">/scheduling</a> before capturing damage.
      </div>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (posting) return
    if (!location.trim()) return
    setPosting(true)
    try {
      const r = await fetch(`/api/orders/${orderId}/return-damage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingAssignmentId,
          findings: [{
            locationOnVehicle: location.trim(),
            damageType,
            severity,
            estimatedRepairCost: cost.trim() === '' ? null : Number(cost),
            notes: notes.trim() || null,
            isPreExisting,
            disposition,
          }],
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.ok) {
        onPostFailed(data.error || `HTTP ${r.status}`)
        return
      }
      await onSaved()
    } finally {
      setPosting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 grid grid-cols-1 sm:grid-cols-12 gap-2"
    >
      <label className="sm:col-span-4 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
        Vehicle
        <select
          value={bookingAssignmentId}
          onChange={(e) => setBookingAssignmentId(e.target.value)}
          className="mt-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white outline-none focus:border-zinc-500 normal-case tracking-normal"
        >
          {assignments.map((a) => (
            <option key={a.id} value={a.id}>{a.asset.unitName} · {a.status}</option>
          ))}
        </select>
      </label>
      <label className="sm:col-span-4 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
        Location
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="driver side rear panel"
          required
          className="mt-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white outline-none focus:border-zinc-500 normal-case tracking-normal"
        />
      </label>
      <label className="sm:col-span-2 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
        Type
        <select
          value={damageType}
          onChange={(e) => setDamageType(e.target.value as DamageType)}
          className="mt-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white outline-none focus:border-zinc-500 normal-case tracking-normal"
        >
          {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
      </label>
      <label className="sm:col-span-2 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
        Severity
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity)}
          className="mt-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white outline-none focus:border-zinc-500 normal-case tracking-normal"
        >
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="sm:col-span-3 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
        Est. repair cost
        <input
          type="number"
          step="0.01"
          min="0"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder="0.00"
          className="mt-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white outline-none focus:border-zinc-500 normal-case tracking-normal"
        />
      </label>
      <label className="sm:col-span-3 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
        Initial disposition
        <select
          value={disposition}
          onChange={(e) => setDisposition(e.target.value as Disposition)}
          className="mt-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white outline-none focus:border-zinc-500 normal-case tracking-normal"
        >
          {DISPOSITIONS.map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
        </select>
      </label>
      <label className="sm:col-span-4 flex flex-col text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
        Notes
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white outline-none focus:border-zinc-500 normal-case tracking-normal"
        />
      </label>
      <label className="sm:col-span-2 flex items-end gap-1 text-[11px] text-zinc-400 normal-case tracking-normal">
        <input
          type="checkbox"
          checked={isPreExisting}
          onChange={(e) => setIsPreExisting(e.target.checked)}
          className="accent-amber-500"
        />
        Pre-existing
      </label>
      <div className="sm:col-span-12 flex justify-end gap-2 mt-1">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-semibold border border-zinc-700 text-zinc-300 hover:border-zinc-500 px-3 py-1.5 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={posting || !location.trim() || !bookingAssignmentId}
          className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg"
        >
          {posting ? 'Saving…' : 'Save damage'}
        </button>
      </div>
    </form>
  )
}
