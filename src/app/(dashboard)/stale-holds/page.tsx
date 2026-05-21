'use client'

/**
 * Stale holds — Chunk 6 of native-scheduling-v1-brief.md.
 *
 * Lists BookingItems with status=REQUESTED whose parent Booking was
 * created more than N days ago (default 14). One-click release per
 * row flips status → UNFULFILLED. Manual sweep only; no cron.
 *
 * Partially-assigned items (some BookingAssignments but still
 * REQUESTED because count < quantity) are included so reps can see
 * them too and decide whether to keep working the remaining slots or
 * release the rest.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface CompanyLite {
  id: string
  name: string
}
interface PersonLite {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
}
interface AgentLite {
  id: string
  name: string | null
  email: string | null
}

interface StaleHoldRow {
  bookingItemId: string
  bookingId: string
  bookingNumber: string
  jobName: string
  productionName: string | null
  category: { id: string; name: string; slug: string }
  quantity: number
  assignedCount: number
  remaining: number
  rentalStart: string
  rentalEnd: string
  createdAt: string
  ageDays: number
  company: CompanyLite | null
  person: PersonLite | null
  agent: AgentLite | null
  bookingStatus: string
  notes: string | null
}

interface StaleHoldsResponse {
  ok: boolean
  days: number
  cutoff: string
  count: number
  rows: StaleHoldRow[]
}

function personName(p: PersonLite | null): string {
  if (!p) return '—'
  const n = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()
  return n || p.email || '—'
}

export default function StaleHoldsPage() {
  const [days, setDays] = useState<number>(14)
  const [data, setData] = useState<StaleHoldsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [releasing, setReleasing] = useState<string | null>(null)
  const [released, setReleased] = useState<Set<string>>(new Set())
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = useCallback(async (d: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/scheduling/stale-holds?days=${d}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || `request failed (${res.status})`)
      setData(json)
      setReleased(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function release(itemId: string) {
    setReleasing(itemId)
    setError(null)
    try {
      const res = await fetch(`/api/scheduling/booking-items/${itemId}/release`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.reason || json.error || `request failed (${res.status})`)
      setReleased((s) => {
        const next = new Set(s)
        next.add(itemId)
        return next
      })
      setConfirmId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReleasing(null)
    }
  }

  const visibleRows = useMemo(() => {
    if (!data) return [] as StaleHoldRow[]
    return data.rows.filter((r) => !released.has(r.bookingItemId))
  }, [data, released])

  return (
    <div className="p-6 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Stale holds</h1>
        <p className="text-sm text-zinc-600 mt-1">
          BookingItems with status=REQUESTED whose parent Booking is older than the threshold. Manual sweep — no cron.
          Releasing flips the item's status to <code className="bg-zinc-100 px-1 rounded">UNFULFILLED</code>; the parent
          Booking is left alone.
        </p>
      </header>

      <section className="bg-white border border-zinc-200 rounded-lg p-4 mb-4">
        <div className="flex items-end gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-600">Threshold (days)</span>
            <input
              type="number"
              min={0}
              max={365}
              value={days}
              onChange={(e) => setDays(Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
              className="mt-1 block w-28 rounded border-zinc-300 text-sm px-2 py-1.5"
            />
          </label>
          <button
            onClick={() => load(days)}
            disabled={loading}
            className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-sm font-medium px-4 py-1.5 rounded"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {data && (
            <div className="text-sm text-zinc-600 ml-auto">
              Showing <span className="font-semibold text-zinc-900">{visibleRows.length}</span> stale hold(s) older than
              {' '}
              {data.days} day(s) (cutoff {data.cutoff.slice(0, 10)})
            </div>
          )}
        </div>
        {error && <div className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>}
        {released.size > 0 && (
          <div className="mt-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            Released {released.size} hold(s) this session.
          </div>
        )}
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Booking</th>
              <th className="text-left px-3 py-2 font-medium">Job</th>
              <th className="text-left px-3 py-2 font-medium">Category</th>
              <th className="text-right px-3 py-2 font-medium">Qty</th>
              <th className="text-left px-3 py-2 font-medium">Rental window</th>
              <th className="text-left px-3 py-2 font-medium">Age</th>
              <th className="text-left px-3 py-2 font-medium">Company / Contact</th>
              <th className="text-left px-3 py-2 font-medium">Agent</th>
              <th className="text-right px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {visibleRows.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-zinc-500">
                  No stale holds older than {data?.days ?? days} day(s).
                </td>
              </tr>
            )}
            {visibleRows.map((r) => (
              <tr key={r.bookingItemId} className="hover:bg-zinc-50 align-top">
                <td className="px-3 py-2 font-mono text-zinc-900">{r.bookingNumber}</td>
                <td className="px-3 py-2">
                  <div className="text-zinc-900">{r.jobName}</div>
                  {r.productionName && <div className="text-xs text-zinc-500">{r.productionName}</div>}
                </td>
                <td className="px-3 py-2 text-zinc-700">{r.category.name}</td>
                <td className="px-3 py-2 text-right">
                  <span className="text-zinc-900">{r.assignedCount}</span>
                  <span className="text-zinc-400">/{r.quantity}</span>
                </td>
                <td className="px-3 py-2 text-zinc-700">
                  {r.rentalStart.slice(0, 10)} → {r.rentalEnd.slice(0, 10)}
                </td>
                <td className="px-3 py-2 text-zinc-700">
                  <span className={r.ageDays >= 30 ? 'text-rose-700 font-medium' : ''}>{r.ageDays}d</span>
                </td>
                <td className="px-3 py-2">
                  <div className="text-zinc-900">{r.company?.name ?? '—'}</div>
                  <div className="text-xs text-zinc-500">{personName(r.person)}</div>
                </td>
                <td className="px-3 py-2 text-zinc-700">{r.agent?.name ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  {confirmId === r.bookingItemId ? (
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => release(r.bookingItemId)}
                        disabled={releasing === r.bookingItemId}
                        className="bg-rose-600 hover:bg-rose-500 disabled:bg-zinc-300 text-white text-xs font-medium px-2 py-1 rounded"
                      >
                        {releasing === r.bookingItemId ? 'Releasing…' : 'Confirm release'}
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="text-xs text-zinc-700 hover:text-zinc-900 px-2 py-1"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(r.bookingItemId)}
                      className="border border-zinc-300 hover:bg-zinc-50 text-zinc-800 text-xs font-medium px-2.5 py-1 rounded"
                    >
                      Release
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
