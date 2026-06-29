'use client'

/**
 * AssignUnitsModal — Chunk 5 of native-scheduling-v1-brief.md.
 *
 * Per-BookingItem assignment picker. Shows the current assigned
 * units, the remaining slots, and a candidate list sorted by tier
 * (PREMIUM > STANDARD > ECONOMY). Each candidate's per-window state
 * (free / buffer / booked) is rendered as a badge — booked candidates
 * are kept in the list so the agent can see *why* a unit isn't
 * pickable, but they're disabled.
 *
 * Buffer-state picks hit the soft-warn path on submit; the modal
 * surfaces the warning and the agent can choose to "Override & assign".
 */

import { useCallback, useEffect, useState } from 'react'

type UnitState = 'free' | 'buffer' | 'booked'

interface Candidate {
  assetId: string
  unitName: string
  tier: 'PREMIUM' | 'STANDARD' | 'ECONOMY'
  state: UnitState
}

interface CurrentAssignment {
  id: string
  status: string
  startDate: string
  endDate: string
  asset: { id: string; unitName: string; tier: string }
}

interface PickerData {
  ok: boolean
  bookingItem: { id: string; quantity: number; status: string; assignedCount: number; remaining: number }
  booking: { id: string; bookingNumber: string; jobName: string; startDate: string; endDate: string }
  orderId: string | null
  category: { id: string; name: string; slug: string }
  currentAssignments: CurrentAssignment[]
  candidates: Candidate[]
  summary: {
    serviceableCount: number
    freeCount: number
    bufferCount: number
    bookedCount: number
    availableToHold: number
  }
}

interface AssignUnitsModalProps {
  bookingItemId: string
  bufferDays: number
  onClose: () => void
  onChanged?: () => void
}

const STATE_BADGE: Record<UnitState, string> = {
  free: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  buffer: 'bg-amber-50 text-amber-800 border-amber-200',
  booked: 'bg-rose-50 text-rose-700 border-rose-200',
}

// Plain-English labels — keep schema/enum nouns out of user-facing copy.
const STATE_LABEL: Record<UnitState, string> = { free: 'available', buffer: 'tight', booked: 'booked' }
const ITEM_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Needs units', ASSIGNED: 'Assigned', SUBSTITUTED: 'Substituted', UNFULFILLED: 'Released',
}
const ASSIGN_STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Assigned', CHECKED_OUT: 'Checked out', RETURNED: 'Returned', SWAPPED: 'Swapped',
}

// Category representative image (ad20659) via its existing gated proxy.
// Graceful placeholder when there's no image or the proxy 403s for the user.
function CategoryThumb({ categoryId, alt }: { categoryId: string; alt: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <div className="h-12 w-12 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-zinc-300" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/admin/asset-categories/${categoryId}/image`}
      alt={alt}
      onError={() => setBroken(true)}
      className="h-12 w-12 rounded-lg object-cover border border-zinc-200 shrink-0 bg-zinc-50"
    />
  )
}

export function AssignUnitsModal({ bookingItemId, bufferDays, onClose, onChanged }: AssignUnitsModalProps) {
  const [data, setData] = useState<PickerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<string | null>(null) // assetId mid-submit
  const [error, setError] = useState<string | null>(null)
  const [pendingBuffer, setPendingBuffer] = useState<{ asset: Candidate; reason: string } | null>(null)
  // DOT paperwork (Phase 2): generate the per-vehicle DOT info packet for the
  // order's assigned units + publish it to the client portal.
  type Incomplete = { unitName: string; missing: string[] }
  const [dotBusy, setDotBusy] = useState(false)
  const [dotCheck, setDotCheck] = useState<{ unitCount: number; incomplete: Incomplete[] } | null>(null)
  const [dotResult, setDotResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // Step 1: readiness check (warn BEFORE publishing) — no generation.
  async function checkDot(orderId: string) {
    setDotBusy(true); setDotResult(null); setDotCheck(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/dot-sheet?check=1`)
      const json = await res.json()
      if (!res.ok || !json.ok) { setDotResult({ ok: false, msg: json.error || `Couldn't read DOT data (${res.status})` }); return }
      setDotCheck({ unitCount: json.unitCount, incomplete: json.incompleteUnits || [] })
    } catch (e) {
      setDotResult({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally { setDotBusy(false) }
  }

  // Step 2: generate + publish to the client portal.
  async function sendDotPaperwork(orderId: string) {
    setDotBusy(true); setDotResult(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/dot-sheet`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.ok) { setDotResult({ ok: false, msg: json.error || `Couldn't build the DOT sheet (${res.status})` }); return }
      setDotCheck(null)
      setDotResult({
        ok: true,
        msg: `DOT info sheet ready for ${json.unitCount} vehicle${json.unitCount === 1 ? '' : 's'} — the client can now download it from their portal.`,
      })
    } catch (e) {
      setDotResult({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally { setDotBusy(false) }
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/scheduling/booking-items/${bookingItemId}/available-units?bufferDays=${bufferDays}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || `request failed (${res.status})`)
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [bookingItemId, bufferDays])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function unassign(assetId: string) {
    setSubmitting(assetId)
    setError(null)
    try {
      const res = await fetch(`/api/scheduling/booking-items/${bookingItemId}/unassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId }),
      })
      const json = await res.json()
      if (res.ok && json.ok) {
        await refresh()
        onChanged?.()
        return
      }
      setError(json.reason || json.error || `Request failed (${res.status})`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(null)
    }
  }

  async function assign(asset: Candidate, bufferOverride: boolean) {
    setSubmitting(asset.assetId)
    setError(null)
    try {
      const res = await fetch(`/api/scheduling/booking-items/${bookingItemId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.assetId, bufferDays, bufferOverride }),
      })
      const json = await res.json()
      if (res.ok && json.ok) {
        setPendingBuffer(null)
        await refresh()
        onChanged?.()
        return
      }
      if (res.status === 409 && json.error === 'buffer-encroachment' && json.needsOverride) {
        setPendingBuffer({ asset, reason: json.reason })
        return
      }
      setError(json.reason || json.error || `Request failed (${res.status})`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <header className="flex items-start justify-between px-6 py-4 border-b border-zinc-200">
          <div className="flex items-start gap-3">
            {data && <CategoryThumb categoryId={data.category.id} alt={data.category.name} />}
            <div>
            <h2 className="text-lg font-semibold text-zinc-900">Assign units</h2>
            {data && (
              <p className="text-sm text-zinc-600 mt-0.5">
                {data.booking.bookingNumber} · {data.booking.jobName} · {data.category.name} ·{' '}
                {data.booking.startDate.slice(0, 10)} → {data.booking.endDate.slice(0, 10)}
              </p>
            )}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-xl leading-none">×</button>
        </header>

        <div className="px-6 py-4 space-y-4">
          {loading && <div className="text-sm text-zinc-500">Loading…</div>}

          {data && (
            <>
              <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm flex items-center gap-2">
                <span className="font-semibold text-zinc-900">{Math.max(0, data.summary.availableToHold)}</span>
                <span className="text-zinc-600">of {data.summary.serviceableCount} units available these dates</span>
                <span className="ml-auto text-xs text-zinc-500">
                  available {data.summary.freeCount} · tight {data.summary.bufferCount} · booked {data.summary.bookedCount}
                </span>
              </div>

              <div className="flex items-center gap-4 text-sm">
                <div className="text-zinc-700">
                  <span className="font-semibold">{data.bookingItem.assignedCount}</span> of {data.bookingItem.quantity} assigned
                </div>
                <div className="ml-auto">
                  <span
                    className={`inline-block text-xs px-2 py-0.5 rounded border ${
                      data.bookingItem.status === 'ASSIGNED'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-zinc-50 text-zinc-700 border-zinc-200'
                    }`}
                  >
                    {ITEM_STATUS_LABEL[data.bookingItem.status] ?? data.bookingItem.status}
                  </span>
                </div>
              </div>

              {data.currentAssignments.length > 0 && (
                <section>
                  <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Assigned</div>
                  <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded">
                    {data.currentAssignments.map((a) => (
                      <li key={a.id} className="px-3 py-2 text-sm flex items-center justify-between">
                        <div>
                          <span className="font-mono text-zinc-900">{a.asset.unitName}</span>
                          <span className="ml-2 text-xs text-zinc-500">{a.asset.tier}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-500">{ASSIGN_STATUS_LABEL[a.status] ?? a.status}</span>
                          {a.status === 'ASSIGNED' && (
                            <button
                              onClick={() => unassign(a.asset.id)}
                              disabled={!!submitting}
                              className="text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-40"
                            >
                              {submitting === a.asset.id ? 'Removing…' : 'Remove'}
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.bookingItem.remaining === 0 ? (
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  This hold is fully assigned.
                </div>
              ) : (
                <section>
                  <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
                    Available units · best first
                  </div>
                  <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded">
                    {data.candidates.length === 0 && (
                      <li className="px-3 py-3 text-sm text-zinc-500">No units available for these dates.</li>
                    )}
                    {data.candidates.map((c) => {
                      const isBooked = c.state === 'booked'
                      const isPendingThis = submitting === c.assetId
                      return (
                        <li key={c.assetId} className="px-3 py-2 text-sm flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-zinc-900">{c.unitName}</span>
                            <span className="text-xs text-zinc-500">{c.tier}</span>
                            <span className={`inline-block text-xs px-2 py-0.5 rounded border ${STATE_BADGE[c.state]}`}>
                              {c.state}
                            </span>
                          </div>
                          <button
                            onClick={() => assign(c, false)}
                            disabled={isBooked || !!submitting}
                            className="border border-zinc-300 hover:bg-zinc-50 disabled:opacity-40 text-zinc-800 text-xs font-medium px-2.5 py-1 rounded"
                          >
                            {isPendingThis ? 'Assigning…' : 'Assign'}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {pendingBuffer && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
                  <div className="font-medium text-amber-900">Buffer encroachment on {pendingBuffer.asset.unitName}</div>
                  <div className="text-amber-800 mt-0.5">{pendingBuffer.reason}</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => assign(pendingBuffer.asset, true)}
                      disabled={!!submitting}
                      className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-xs font-medium px-3 py-1 rounded"
                    >
                      {submitting ? 'Forcing…' : 'Override buffer & assign'}
                    </button>
                    <button
                      onClick={() => setPendingBuffer(null)}
                      className="text-xs text-zinc-700 hover:text-zinc-900 px-2 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
              )}

              {/* DOT paperwork — generate the per-vehicle DOT info packet for
                  this job's assigned vehicles + publish it to the client portal. */}
              {data.orderId && (
                <section className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-zinc-800">DOT paperwork</div>
                    {!dotCheck && (
                      <button
                        onClick={() => checkDot(data.orderId!)}
                        disabled={dotBusy}
                        className="border border-zinc-300 hover:bg-white disabled:opacity-40 text-zinc-800 text-xs font-semibold px-3 py-1.5 rounded"
                      >
                        {dotBusy ? 'Checking…' : 'Send DOT paperwork'}
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Year, make, VIN, plate &amp; latest BIT for the vehicles assigned to this job — published to the client&apos;s portal.
                  </p>

                  {dotCheck && (
                    <div className="mt-2 space-y-2">
                      {dotCheck.unitCount === 0 ? (
                        <div className="text-xs text-rose-700">No assigned vehicle units on this job yet — assign units first.</div>
                      ) : dotCheck.incomplete.length > 0 ? (
                        <div className="rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                          <div className="font-semibold">Heads up — some vehicles are missing info:</div>
                          <ul className="mt-1 list-disc list-inside">
                            {dotCheck.incomplete.map((u) => (
                              <li key={u.unitName}><span className="font-mono">{u.unitName}</span> — missing {u.missing.join(', ')}</li>
                            ))}
                          </ul>
                          <div className="mt-1">The sheet will show these as &ldquo;Not on file.&rdquo; Send anyway?</div>
                        </div>
                      ) : (
                        <div className="text-xs text-emerald-700">{dotCheck.unitCount} vehicle{dotCheck.unitCount === 1 ? '' : 's'} ready — all DOT info on file.</div>
                      )}
                      {dotCheck.unitCount > 0 && (
                        <div className="flex gap-2">
                          <button onClick={() => sendDotPaperwork(data.orderId!)} disabled={dotBusy} className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-xs font-semibold px-3 py-1.5 rounded">
                            {dotBusy ? 'Generating…' : dotCheck.incomplete.length > 0 ? 'Generate & publish anyway' : 'Generate & publish to portal'}
                          </button>
                          <button onClick={() => setDotCheck(null)} className="text-xs text-zinc-600 hover:text-zinc-900 px-2 py-1.5">Cancel</button>
                        </div>
                      )}
                    </div>
                  )}

                  {dotResult && (
                    <div className={`mt-2 rounded border px-2.5 py-2 text-xs ${dotResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'}`}>
                      {dotResult.msg}
                      {dotResult.ok && (
                        <> <a href={`/api/orders/${data.orderId}/dot-sheet`} target="_blank" rel="noreferrer" className="font-semibold underline ml-1">Download a copy</a></>
                      )}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        <footer className="px-6 py-3 border-t border-zinc-200 flex items-center justify-end">
          <button onClick={onClose} className="text-sm text-zinc-700 hover:text-zinc-900 px-3 py-1.5">
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
