'use client'

/**
 * "Change dates" modal — deliberate, preview-first flow for moving an
 * order's date range. Sales hits this when a job pushes; the modal
 * shows the cascade (totals delta, asset conflicts, custom-dated
 * items) before anything writes.
 *
 * Flow:
 *   1. Rep enters new start + end. We debounce-fetch
 *      POST /api/orders/[id]/dates/preview and render the cascade.
 *   2. Per-custom-item dropdowns (default 'keep') let the rep pick
 *      shift-by-offset vs leave-alone.
 *   3. Conflicts surface red. Confirm button is disabled unless the
 *      rep explicitly ticks "I've reviewed these conflicts and want
 *      to push anyway".
 *   4. On Apply, POST /api/orders/[id]/dates/apply with the same body
 *      + overrideConflicts. Closes on success and calls onChanged.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

type CustomItemAction = 'shift' | 'keep'

type Classification = 'inherited' | 'custom_shifted' | 'custom_kept'

interface ProjectedItem {
  id: string
  description: string
  department: string
  classification: Classification
  startDate: string | null
  endDate: string | null
  pickupDate: string
  returnDate: string
  billableDaysOld: number
  billableDaysNew: number
  lineTotalOld: number
  lineTotalNew: number
}

interface Totals {
  rawSubtotal: number
  taxAmount: number
  total: number
}

interface Conflict {
  assetId: string
  unitName: string | null
  assignmentId: string
  assignmentStatus: string
  bookingId: string
  bookingNumber: string
  jobName: string
  bookingStartDate: string
  bookingEndDate: string
}

interface PreviewResponse {
  currentRange: { startDate: string; endDate: string; calendarDays: number }
  newRange: { startDate: string; endDate: string; calendarDays: number }
  offsetDays: number
  projectedItems: ProjectedItem[]
  currentTotals: Totals
  projectedTotals: Totals
  delta: { subtotal: number; tax: number; total: number }
  conflicts: Conflict[]
  postBooking: boolean
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function toInputDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (!Number.isFinite(date.getTime())) return ''
  // YYYY-MM-DD in local time (good enough for a Date column input).
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function PushDatesModal({
  orderId,
  currentStartDate,
  currentEndDate,
  postBooking,
  onClose,
  onChanged,
}: {
  orderId: string
  currentStartDate: string
  currentEndDate: string
  /** True when order status is past APPROVED — preview also surfaces
   *  this from the server, but the parent can pre-color the modal. */
  postBooking: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [newStart, setNewStart] = useState(toInputDate(currentStartDate))
  const [newEnd, setNewEnd] = useState(toInputDate(currentEndDate))
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customActions, setCustomActions] = useState<Record<string, CustomItemAction>>({})
  const [acknowledgeConflicts, setAcknowledgeConflicts] = useState(false)
  const [applying, setApplying] = useState(false)

  const datesValid = useMemo(() => {
    if (!newStart || !newEnd) return false
    return new Date(newEnd).getTime() > new Date(newStart).getTime()
  }, [newStart, newEnd])

  const datesUnchanged = useMemo(() => {
    return newStart === toInputDate(currentStartDate) && newEnd === toInputDate(currentEndDate)
  }, [newStart, newEnd, currentStartDate, currentEndDate])

  const fetchPreview = useCallback(async () => {
    if (!datesValid) {
      setPreview(null)
      return
    }
    setPreviewing(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/dates/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: newStart,
          endDate: newEnd,
          customItemActions: customActions,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`)
        setPreview(null)
        return
      }
      setPreview(data as PreviewResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'preview failed')
    } finally {
      setPreviewing(false)
    }
  }, [orderId, newStart, newEnd, customActions, datesValid])

  // Debounce preview on date/action changes.
  useEffect(() => {
    if (!datesValid) {
      setPreview(null)
      return
    }
    const handle = setTimeout(() => { fetchPreview() }, 300)
    return () => clearTimeout(handle)
  }, [fetchPreview, datesValid])

  const customItems = useMemo(
    () => preview?.projectedItems.filter((p) => p.classification !== 'inherited') ?? [],
    [preview],
  )
  const conflicts = preview?.conflicts ?? []
  const canApply =
    preview != null
    && datesValid
    && !datesUnchanged
    && (conflicts.length === 0 || acknowledgeConflicts)
    && !applying

  const apply = async () => {
    if (!preview) return
    setApplying(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/dates/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: newStart,
          endDate: newEnd,
          customItemActions: customActions,
          overrideConflicts: conflicts.length > 0 ? acknowledgeConflicts : false,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`)
        return
      }
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'apply failed')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8">
      <div className="bg-lt-card border border-lt-hairline rounded-xl w-full max-w-3xl max-h-full overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-lt-hairline flex items-center justify-between">
          <h3 className="text-lg font-semibold text-lt-fg">Change order dates</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="text-sm text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
          >
            Close ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Date inputs */}
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-lt-fg3 mb-1 block">New start date</span>
              <input
                type="date"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1.5 text-sm text-lt-fg"
              />
            </label>
            <label className="block">
              <span className="text-xs text-lt-fg3 mb-1 block">New end date</span>
              <input
                type="date"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1.5 text-sm text-lt-fg"
              />
            </label>
          </div>

          {error && (
            <div className="text-sm text-chip-bad-fg bg-chip-bad-bg/30 px-3 py-2 rounded">{error}</div>
          )}
          {previewing && !preview && (
            <div className="text-sm text-lt-fg2">Computing preview…</div>
          )}

          {preview && (
            <>
              {/* Totals delta */}
              <section>
                <h4 className="text-sm font-semibold text-lt-fg mb-2">Totals</h4>
                <div className="bg-lt-inner/40 border border-lt-hairline rounded p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-lt-fg2">Calendar days</span>
                    <span className="text-lt-fg font-mono">
                      {preview.currentRange.calendarDays} → {preview.newRange.calendarDays}
                      {preview.offsetDays !== 0 && (
                        <span className="text-lt-fg3 ml-2">(offset {preview.offsetDays > 0 ? '+' : ''}{preview.offsetDays}d)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-lt-fg2">Subtotal</span>
                    <span className="text-lt-fg font-mono">
                      {fmt(preview.currentTotals.rawSubtotal)} → {fmt(preview.projectedTotals.rawSubtotal)}
                      <DeltaBadge n={preview.delta.subtotal} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-lt-fg2">Tax</span>
                    <span className="text-lt-fg font-mono">
                      {fmt(preview.currentTotals.taxAmount)} → {fmt(preview.projectedTotals.taxAmount)}
                      <DeltaBadge n={preview.delta.tax} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1 pt-1 border-t border-lt-hairline">
                    <span className="text-lt-fg font-medium">Total</span>
                    <span className="text-lt-fg font-mono font-medium">
                      {fmt(preview.currentTotals.total)} → {fmt(preview.projectedTotals.total)}
                      <DeltaBadge n={preview.delta.total} />
                    </span>
                  </div>
                </div>
                {preview.postBooking && (
                  <div className="text-xs text-chip-warn-fg mt-2">
                    ⚠ Order is past booking — the invoice will reflect this change as an adjustment.
                  </div>
                )}
              </section>

              {/* Conflicts */}
              <section>
                <h4 className="text-sm font-semibold text-lt-fg mb-2">
                  Availability {conflicts.length > 0 && <span className="text-chip-bad-fg">— {conflicts.length} conflict(s)</span>}
                </h4>
                {conflicts.length === 0 ? (
                  <div className="text-sm text-lt-fg3">No asset conflicts in the new range.</div>
                ) : (
                  <>
                    <div className="border border-chip-bad-fg/40 rounded divide-y divide-lt-hairline">
                      {conflicts.map((c) => (
                        <div key={c.assignmentId} className="px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-lt-fg">
                              {c.unitName || c.assetId.slice(0, 8)}
                            </span>
                            <span className="text-xs text-chip-bad-fg">
                              {fmtDate(c.bookingStartDate)} – {fmtDate(c.bookingEndDate)}
                            </span>
                          </div>
                          <div className="text-xs text-lt-fg2 mt-0.5">
                            Booked on <a href={`/jobs/${c.bookingId}`} className="text-lt-fg hover:underline">{c.bookingNumber}</a>
                            {c.jobName && <span> · {c.jobName}</span>}
                            <span className="ml-2 text-lt-fg3">({c.assignmentStatus.toLowerCase()})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-sm text-lt-fg">
                      <input
                        type="checkbox"
                        checked={acknowledgeConflicts}
                        onChange={(e) => setAcknowledgeConflicts(e.target.checked)}
                      />
                      Push anyway — I've reviewed these conflicts.
                    </label>
                  </>
                )}
              </section>

              {/* Custom-dated items */}
              {customItems.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold text-lt-fg mb-2">Custom-dated items</h4>
                  <div className="text-xs text-lt-fg3 mb-2">
                    These items have their own dates. Choose whether to shift each by the same offset
                    or keep its current range.
                  </div>
                  <div className="border border-lt-hairline rounded divide-y divide-lt-hairline">
                    {customItems.map((it) => (
                      <div key={it.id} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-lt-fg truncate">{it.description}</div>
                          <div className="text-xs text-lt-fg3">
                            {fmtDate(it.pickupDate)} – {fmtDate(it.returnDate)}
                            {' · '}
                            {it.billableDaysOld} day{it.billableDaysOld === 1 ? '' : 's'} · {fmt(it.lineTotalOld)}
                          </div>
                        </div>
                        <select
                          value={customActions[it.id] ?? 'keep'}
                          onChange={(e) => setCustomActions((m) => ({ ...m, [it.id]: e.target.value as CustomItemAction }))}
                          className="bg-lt-inner border border-lt-hairline rounded px-2 py-1 text-xs text-lt-fg"
                        >
                          <option value="keep">Keep as-is</option>
                          <option value="shift">Shift by {preview.offsetDays > 0 ? '+' : ''}{preview.offsetDays}d</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Inherited items summary */}
              {(() => {
                const inh = preview.projectedItems.filter((p) => p.classification === 'inherited')
                if (inh.length === 0) return null
                return (
                  <section className="text-xs text-lt-fg3">
                    {inh.length} inherited item{inh.length === 1 ? '' : 's'} will follow the new order range automatically.
                  </section>
                )
              })()}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-lt-hairline flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="px-4 py-1.5 text-sm text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!canApply}
            className="px-4 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50"
          >
            {applying ? 'Applying…' : 'Apply date change'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeltaBadge({ n }: { n: number }) {
  if (Math.abs(n) < 0.005) return null
  const positive = n > 0
  return (
    <span className={`ml-2 text-xs ${positive ? 'text-chip-warn-fg' : 'text-chip-good-fg'}`}>
      ({positive ? '+' : ''}{fmt(n)})
    </span>
  )
}
