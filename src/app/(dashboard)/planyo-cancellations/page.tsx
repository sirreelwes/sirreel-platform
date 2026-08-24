'use client'

/**
 * Planyo cancellations — the human review queue for RELEASE_CANDIDATEs.
 *
 * The daily sync detects holds that Planyo says are cancelled but that
 * still consume capacity in HQ. It deliberately does not act on them: a
 * false positive frees a truck that is genuinely booked. Until now the
 * only signal was a Slack alert, so anything nobody read stayed on the
 * board indefinitely — which is exactly what happened while the cron was
 * dying silently for six days.
 *
 * Releasing calls the SAME endpoint the stale-holds sweep uses, so there
 * is one release path in the system rather than a second implementation
 * that could drift from it.
 */

import { useCallback, useEffect, useState } from 'react'

interface Candidate {
  planyoReservationId: string | null
  planyoCartId: string | null
  unitName: string | null
  startTime: string | null
  endTime: string | null
  companyName: string | null
  jobName: string | null
  bookingNumber: string | null
  bookingItemId: string | null
  matchedBy: 'unit' | 'single-item' | null
  alreadyReleased: boolean
  itemStatus: string | null
  detail: string | null
}
interface RunInfo {
  startedAt: string
  finishedAt: string | null
  dryRun: boolean
  outcome: string
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—'

export default function PlanyoCancellationsPage() {
  const [run, setRun] = useState<RunInfo | null>(null)
  const [rows, setRows] = useState<Candidate[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const res = await fetch('/api/scheduling/planyo-release-candidates')
    if (!res.ok) { setErr('Could not load candidates.'); setRows([]); return }
    const j = await res.json()
    setRun(j.run ?? null)
    setRows(j.candidates ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function release(c: Candidate) {
    if (!c.bookingItemId) return
    setBusy(c.planyoReservationId ?? ''); setErr(null)
    try {
      const res = await fetch(`/api/scheduling/booking-items/${c.bookingItemId}/release`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || j.reason || 'Release failed')
      setDone((d) => ({ ...d, [c.planyoReservationId ?? '']: j.alreadyReleased ? 'Already released' : 'Released' }))
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Release failed')
    } finally { setBusy(null) }
  }

  const pending = (rows ?? []).filter((r) => !r.alreadyReleased)
  const cleared = (rows ?? []).filter((r) => r.alreadyReleased)
  const stale = run && (Date.now() - new Date(run.startedAt).getTime()) > 36 * 60 * 60 * 1000

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-gray-900">Planyo cancellations</h1>
        <p className="mt-1 text-sm text-gray-500 max-w-2xl">
          Holds cancelled in Planyo that are still holding a unit in HQ. Nothing is released
          automatically — check each one, then release it here. Releasing frees the unit and
          flips its assignment to SWAPPED, which stays on the record.
        </p>
        {run && (
          <p className={`mt-2 text-xs ${stale ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>
            From the sync run of {new Date(run.startedAt).toLocaleString('en-US')} · {run.outcome}
            {run.dryRun ? ' · plan phase' : ''}
            {stale && ' — that read is over a day old; the daily sync may not be completing.'}
          </p>
        )}
      </header>

      {err && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{err}</div>}

      {rows === null ? (
        <div className="py-10 text-center text-[13px] text-gray-400">Loading…</div>
      ) : pending.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
          <div className="text-[15px] text-gray-600">Nothing to release.</div>
          <div className="mt-1 text-[13px] text-gray-400">
            No cancelled Planyo holds are still consuming capacity.
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5">Unit</th>
                <th className="px-4 py-2.5">Dates</th>
                <th className="px-4 py-2.5">Client / job</th>
                <th className="px-4 py-2.5">Booking</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pending.map((c) => {
                const key = c.planyoReservationId ?? ''
                return (
                  <tr key={key}>
                    <td className="px-4 py-3 align-top">
                      <div className="text-[14px] font-semibold text-gray-900">{c.unitName || '—'}</div>
                      {c.matchedBy === 'single-item' && (
                        <div className="text-[11px] text-amber-700" title="Matched because the booking has only one line">
                          matched by booking, not unit
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-[13px] text-gray-700 whitespace-nowrap">
                      {fmt(c.startTime)} – {fmt(c.endTime)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="text-[13px] text-gray-900">{c.companyName || '—'}</div>
                      <div className="text-[12px] text-gray-500 truncate max-w-[280px]">{c.jobName || ''}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-[12px] text-gray-500">
                      <div>{c.bookingNumber || '—'}</div>
                      <div className="text-[11px] text-gray-400">Planyo #{c.planyoReservationId}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      {done[key] ? (
                        <span className="text-[12px] font-semibold text-emerald-700">✓ {done[key]}</span>
                      ) : c.bookingItemId ? (
                        <button
                          onClick={() => release(c)}
                          disabled={busy === key}
                          className="rounded-lg bg-gray-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
                        >
                          {busy === key ? 'Releasing…' : 'Release'}
                        </button>
                      ) : (
                        <span className="text-[11px] text-amber-700" title="Couldn't map this to a booking line — handle on the board">
                          needs manual review
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {cleared.length > 0 && (
        <p className="mt-3 text-[12px] text-gray-400">
          {cleared.length} candidate{cleared.length === 1 ? '' : 's'} in this run {cleared.length === 1 ? 'was' : 'were'} already released.
        </p>
      )}
    </div>
  )
}
