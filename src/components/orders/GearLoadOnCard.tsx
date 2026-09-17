'use client'

/**
 * Where the gear on this order loads — the note at the bottom of an order
 * that carries production supplies, walkies, expendables: will call at
 * the warehouse, or loaded onto ONE OF THE VEHICLES RESERVED on the job.
 *
 * Wes 2026-09-16: "we need orders that are going on the vehicles (for
 * instance, production supplies and walkies) to be able to be notated at
 * the bottom of that order with where to load that order. It has to be
 * onto one of the vehicles that is reserved."
 *
 * The choices are the job's LIVE reservations (ASSIGNED / CHECKED_OUT
 * units on any of its bookings) — not a free-text truck. A vehicle that
 * has since been released shows as a warning, not a silent blank, so the
 * yard never loads onto a truck that is not going out.
 *
 * Writes `PATCH /api/orders/[id]/gear-handoff`, which re-checks the
 * unit is reserved on this job. Read by the order header, the pick page
 * and the pick-list PDF ("LOAD ON CUBE 34").
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Truck } from 'lucide-react'

export interface ReservedUnitChoice {
  assignmentId: string
  unitName: string
  category: string | null
  /** ISO dates of the reservation window. */
  startDate: string
  endDate: string
  /** The order the vehicle was quoted on — often a sibling of this one. */
  orderNumber: string | null
  orderId: string | null
}

const fmtDay = (iso: string) =>
  new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function GearLoadOnCard({
  orderId,
  jobId,
  gearHandoff,
  gearLoadsOnAssignmentId,
  reservedUnits,
  canEdit,
  onChanged,
}: {
  orderId: string
  jobId: string | null
  gearHandoff: string | null | undefined
  gearLoadsOnAssignmentId: string | null | undefined
  reservedUnits: ReservedUnitChoice[]
  canEdit: boolean
  onChanged: () => void
}) {
  const [mode, setMode] = useState<'WILL_CALL' | 'LOAD_ON' | ''>(
    gearHandoff === 'WILL_CALL' || gearHandoff === 'LOAD_ON' ? gearHandoff : '',
  )
  const [pick, setPick] = useState<string>(gearLoadsOnAssignmentId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Follow the server after a save or a re-read elsewhere on the page.
  useEffect(() => {
    setMode(gearHandoff === 'WILL_CALL' || gearHandoff === 'LOAD_ON' ? gearHandoff : '')
    setPick(gearLoadsOnAssignmentId ?? '')
  }, [gearHandoff, gearLoadsOnAssignmentId])

  const current = reservedUnits.find((u) => u.assignmentId === gearLoadsOnAssignmentId) ?? null
  const stale = gearHandoff === 'LOAD_ON' && !!gearLoadsOnAssignmentId && !current
  const dirty =
    mode !== (gearHandoff === 'WILL_CALL' || gearHandoff === 'LOAD_ON' ? gearHandoff : '') ||
    (mode === 'LOAD_ON' && pick !== (gearLoadsOnAssignmentId ?? ''))

  async function save() {
    if (saving) return
    if (mode === 'LOAD_ON' && !pick) {
      setError('Pick which reserved vehicle the gear loads on.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/gear-handoff`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoff: mode === '' ? null : mode, assignmentId: mode === 'LOAD_ON' ? pick : null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.reason || data.error || `Save failed (HTTP ${res.status})`)
        return
      }
      setSavedAt(Date.now())
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-6">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-lt-fg flex items-center gap-2">
          <Truck className="h-4 w-4 text-lt-fg3" aria-hidden />
          Where this gear loads
        </h2>
        {gearHandoff && !dirty && (
          <span className="text-[12px] text-lt-fg3">
            {gearHandoff === 'WILL_CALL'
              ? 'Will call'
              : current
                ? `Loads on ${current.unitName}`
                : 'Vehicle no longer reserved'}
          </span>
        )}
      </div>
      <p className="text-[13px] text-lt-fg2 mb-3">
        The warehouse reads this on the pick list: the client picks the gear up here, or it goes out on one of the vehicles reserved on this job.
      </p>

      {stale && (
        <div className="mb-3 rounded-md bg-chip-warn-bg text-chip-warn-fg px-3 py-2 text-[13px]">
          This order was set to load on a vehicle that is no longer reserved on the job. Pick one that is, or switch to will call.
        </div>
      )}

      {!canEdit ? (
        <div className="text-[13px] text-lt-fg">
          {gearHandoff === 'WILL_CALL'
            ? 'Will call — the client picks the gear up at the warehouse.'
            : current
              ? `Loads on ${current.unitName}${current.category ? ` (${current.category})` : ''}, ${fmtDay(current.startDate)} → ${fmtDay(current.endDate)}${current.orderNumber ? `, reserved on ${current.orderNumber}` : ''}.`
              : 'Not decided yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How the gear leaves">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'WILL_CALL'}
              onClick={() => setMode('WILL_CALL')}
              className={`text-left text-[13px] rounded-md border px-3 py-2 ${mode === 'WILL_CALL' ? 'bg-amber-600 border-amber-600 text-white' : 'bg-lt-card border-lt-hairline text-lt-fg hover:border-amber-600'}`}
            >
              Will call — the client picks it up at the warehouse
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'LOAD_ON'}
              onClick={() => setMode('LOAD_ON')}
              className={`text-left text-[13px] rounded-md border px-3 py-2 ${mode === 'LOAD_ON' ? 'bg-amber-600 border-amber-600 text-white' : 'bg-lt-card border-lt-hairline text-lt-fg hover:border-amber-600'}`}
            >
              Load on a reserved vehicle
            </button>
          </div>

          {mode === 'LOAD_ON' && (
            reservedUnits.length === 0 ? (
              <div className="text-[13px] text-lt-fg2">
                No vehicle is reserved on this job yet.{' '}
                {jobId && (
                  <Link href={`/jobs/${jobId}#reservations`} className="text-amber-700 hover:text-amber-800 hover:underline font-semibold">
                    Reserve one on the job
                  </Link>
                )}
                {' '}— the gear can only load on a vehicle that is reserved.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Which reserved vehicle">
                {reservedUnits.map((u) => {
                  const on = pick === u.assignmentId
                  return (
                    <button
                      key={u.assignmentId}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setPick(u.assignmentId)}
                      title={u.orderNumber ? `Reserved on ${u.orderNumber}` : 'Reserved on this job'}
                      className={`text-left rounded-md border px-3 py-2 ${on ? 'border-amber-600 bg-amber-50 ring-1 ring-amber-600' : 'border-lt-hairline bg-lt-inner hover:border-amber-600'}`}
                    >
                      <div className="text-[14px] font-semibold text-lt-fg">{u.unitName}</div>
                      <div className="text-[12px] text-lt-fg2">
                        {u.category ?? 'Vehicle'} · {fmtDay(u.startDate)} → {fmtDay(u.endDate)}
                        {u.orderNumber && u.orderId !== orderId ? ` · ${u.orderNumber}` : ''}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={saving || !dirty || (mode === 'LOAD_ON' && !pick)}
              onClick={() => void save()}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[13px] font-semibold px-3 py-1.5 rounded-md"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {gearHandoff && (
              <button
                type="button"
                disabled={saving}
                onClick={() => { setMode(''); setPick(''); void (async () => {
                  setSaving(true); setError(null)
                  try {
                    const res = await fetch(`/api/orders/${orderId}/gear-handoff`, {
                      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ handoff: null }),
                    })
                    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.reason || d.error || 'Could not clear'); return }
                    onChanged()
                  } finally { setSaving(false) }
                })() }}
                className="text-[13px] text-lt-fg3 hover:text-lt-fg underline underline-offset-2"
              >
                Clear
              </button>
            )}
            {error && <span className="text-[13px] text-chip-bad-fg">{error}</span>}
            {!error && savedAt && !dirty && <span className="text-[13px] text-chip-good-fg">Saved</span>}
          </div>
        </div>
      )}
    </div>
  )
}
