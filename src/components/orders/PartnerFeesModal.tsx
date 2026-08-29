'use client'

/**
 * "Partner fees" — put a sub-rented unit's ancillary charges on the order.
 *
 * The gap this closes: the estimate email quoted the client a driver, mileage,
 * generator and supplies charge, and none of it reached the order, so the
 * quote was short by more than the vehicle line itself. Sales had no way to
 * add them short of typing four lines by hand from the partner's rate card.
 *
 * Day-rate fees are shown priced and locked — the order already knows its day
 * count, so there is nothing to ask. Metered fees (mileage, generator hours)
 * are the only inputs, because they are the only numbers nobody knows yet.
 * Leaving one blank omits the line rather than adding it at $0: a zero on a
 * quote reads as "included", which is the opposite of what it means.
 */

import { useCallback, useEffect, useState } from 'react'

interface Candidate {
  id: string
  name: string
  vehicleType: string | null
  onThisJob: boolean
}
interface Fee {
  id: string
  label: string
  amount: string
  unit: string
  coversHours: string | null
  metered: boolean
  usageNoun: string
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

export default function PartnerFeesModal({
  orderId,
  onClose,
  onAdded,
}: {
  orderId: string
  onClose: () => void
  onAdded: () => void
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [addedIds, setAddedIds] = useState<string[]>([])
  const [vehicleId, setVehicleId] = useState<string>('')
  const [vehicleName, setVehicleName] = useState<string>('')
  const [fees, setFees] = useState<Fee[]>([])
  const [days, setDays] = useState(1)
  const [estimates, setEstimates] = useState<Record<string, string>>({})
  const [alreadyAdded, setAlreadyAdded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Candidates first. One unit on the job is the common case, so it is
  // preselected and the rep never sees a picker with a single option.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/orders/${orderId}/partner-fees`)
        const j = await r.json()
        if (!alive) return
        if (!r.ok) { setError(j.error ?? 'Could not load partner units.'); return }
        setCandidates(j.candidates ?? [])
        setAddedIds(j.addedVehicleIds ?? [])
        setDays(j.days ?? 1)
        const first = (j.candidates ?? []).find((c: Candidate) => c.onThisJob) ?? (j.candidates ?? [])[0]
        if (first) setVehicleId(first.id)
      } catch {
        if (alive) setError('Could not load partner units.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [orderId])

  const loadSchedule = useCallback(async (id: string) => {
    setError(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/partner-fees?vehicleId=${encodeURIComponent(id)}`)
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Could not load fees.'); return }
      setFees(j.fees ?? [])
      setDays(j.days ?? 1)
      setVehicleName(j.vehicleName ?? '')
      setAlreadyAdded(!!j.alreadyAdded)
      setEstimates({})
    } catch {
      setError('Could not load fees.')
    }
  }, [orderId])

  useEffect(() => { if (vehicleId) void loadSchedule(vehicleId) }, [vehicleId, loadSchedule])

  const dayFees = fees.filter((f) => !f.metered)
  const meteredFees = fees.filter((f) => f.metered)

  const lineTotal = (f: Fee) => {
    const amt = Number(f.amount)
    if (f.metered) {
      const q = Number(estimates[f.id] ?? 0)
      return Number.isFinite(q) && q > 0 ? amt * q : 0
    }
    return f.unit === 'PER_DAY' ? amt * days : amt
  }
  const total = fees.reduce((sum, f) => sum + lineTotal(f), 0)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, number> = {}
      for (const f of meteredFees) {
        const n = Number(estimates[f.id])
        if (Number.isFinite(n) && n > 0) payload[f.id] = n
      }
      const r = await fetch(`/api/orders/${orderId}/partner-fees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId, estimates: payload }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Could not add the fees.'); return }
      onAdded()
      onClose()
    } catch {
      setError('Could not add the fees.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-bold text-gray-900">Add partner fees</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-gray-500">No subcontracted units on the roster yet.</p>
          ) : (
            <>
              {candidates.length > 1 && (
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-1" htmlFor="pf-vehicle">
                    Partner unit
                  </label>
                  <select
                    id="pf-vehicle"
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                  >
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.vehicleType ? ` — ${c.vehicleType}` : ''}
                        {c.onThisJob ? ' (on this job)' : ''}
                        {addedIds.includes(c.id) ? ' — fees already added' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {alreadyAdded && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {vehicleName}&apos;s fees are already on this order. Remove those lines before re-adding,
                  so the charges can&apos;t double.
                </div>
              )}

              {dayFees.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">
                    Billed per day · {days} {days === 1 ? 'day' : 'days'} on this order
                  </div>
                  <div className="space-y-1.5">
                    {dayFees.map((f) => (
                      <div key={f.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-gray-900">
                          {f.label}
                          {f.coversHours && (
                            <span className="text-xs text-gray-500"> (covers {Number(f.coversHours)} hrs)</span>
                          )}
                        </span>
                        <span className="text-gray-500 text-xs">
                          {money(Number(f.amount))}{f.unit === 'PER_DAY' ? ' / day' : ''} ·{' '}
                          <span className="text-gray-900 font-semibold">{money(lineTotal(f))}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {meteredFees.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-1">
                    Billed as used — your estimate
                  </div>
                  <p className="text-xs text-gray-500 mb-2">
                    The quote shows these as an estimate and says actual usage will be invoiced.
                    Leave one blank to keep it off the quote entirely.
                  </p>
                  <div className="space-y-2">
                    {meteredFees.map((f) => (
                      <div key={f.id} className="flex items-center gap-3">
                        <span className="text-sm text-gray-900 flex-1 min-w-0">
                          {f.label}
                          <span className="text-xs text-gray-500"> · {money(Number(f.amount))} / {f.usageNoun.replace(/s$/, '')}</span>
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={estimates[f.id] ?? ''}
                          placeholder={f.usageNoun}
                          onChange={(e) => setEstimates((p) => ({ ...p, [f.id]: e.target.value }))}
                          className="w-24 text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-right"
                        />
                        <span className="text-xs text-gray-900 font-semibold w-20 text-right">
                          {money(lineTotal(f))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-200">
          <span className="text-sm text-gray-500">
            Adding <span className="font-bold text-gray-900">{money(total)}</span>
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving || loading || alreadyAdded || total <= 0}
              className="px-4 py-1.5 text-sm font-semibold rounded bg-gray-900 text-white hover:bg-black disabled:opacity-40"
            >
              {saving ? 'Adding…' : 'Add to order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
