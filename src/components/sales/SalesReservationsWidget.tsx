'use client'

/**
 * Upcoming-reservations widget for the Sales Pipeline page. Surfaces the
 * shared schedule (the "Reservations" / gantt view) to the sales team
 * without leaving the pipeline. Reads the SAME data the /gantt page uses
 * (`/api/timeline-native`), scoped to the next 14 days, and links out to
 * the full Reservations view. Read-only — no scheduling actions here.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface ReservationJob {
  id: string
  jobId: string | null
  company: string
  jobName: string | null
  jobNum: string
  agent: string
  status: string
  startDate: string // YYYY-MM-DD
  endDate: string
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)
function fmtRange(s: string, e: string): string {
  const opt = { month: 'short', day: 'numeric' } as const
  const sf = new Date(`${s}T00:00:00`).toLocaleDateString('en-US', opt)
  const ef = new Date(`${e}T00:00:00`).toLocaleDateString('en-US', opt)
  return sf === ef ? sf : `${sf} – ${ef}`
}

const WINDOW_DAYS = 14
const MAX_ROWS = 8

export function SalesReservationsWidget() {
  const [jobs, setJobs] = useState<ReservationJob[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const from = new Date()
    const to = new Date()
    to.setDate(to.getDate() + WINDOW_DAYS)
    const params = new URLSearchParams({ from: ymd(from), to: ymd(to) })
    fetch(`/api/timeline-native?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        const list: ReservationJob[] = Array.isArray(d?.jobs) ? d.jobs : []
        list.sort((a, b) => a.startDate.localeCompare(b.startDate))
        setJobs(list)
      })
      .catch(() => setError(true))
  }, [])

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Upcoming Reservations</h2>
          <p className="text-[11px] text-gray-500">Next {WINDOW_DAYS} days · shared schedule</p>
        </div>
        <Link href="/gantt" className="text-xs font-semibold text-amber-700 hover:text-amber-600 whitespace-nowrap">
          View all →
        </Link>
      </div>

      {error ? (
        <p className="text-xs text-gray-400">Couldn’t load reservations.</p>
      ) : jobs === null ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-xs text-gray-400">No reservations in the next {WINDOW_DAYS} days.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {jobs.slice(0, MAX_ROWS).map((j) => {
            const row = (
              <div className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">
                    {j.company}{j.jobName ? ` · ${j.jobName}` : ''}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {j.jobNum}
                    {j.agent ? ` · ${j.agent}` : ''}
                    {j.status ? ` · ${j.status.replace(/_/g, ' ').toLowerCase()}` : ''}
                  </div>
                </div>
                <div className="text-xs font-medium text-gray-700 whitespace-nowrap tabular-nums">
                  {fmtRange(j.startDate, j.endDate)}
                </div>
              </div>
            )
            return j.jobId ? (
              <Link key={j.id} href={`/jobs/${j.jobId}`} className="block -mx-1 px-1 rounded hover:bg-gray-50">
                {row}
              </Link>
            ) : (
              <Link key={j.id} href="/gantt" className="block -mx-1 px-1 rounded hover:bg-gray-50">
                {row}
              </Link>
            )
          })}
          {jobs.length > MAX_ROWS && (
            <Link href="/gantt" className="block text-center text-[11px] font-semibold text-amber-700 hover:text-amber-600 pt-2">
              +{jobs.length - MAX_ROWS} more →
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
