'use client'

/**
 * Payroll — period list.
 *
 * Server-allowlisted: every API call behind this page runs getServerSession +
 * an email check, and the page renders Forbidden if any returns 403. The nav
 * entry is hidden for non-allowlisted users too, but the page does not trust
 * the nav — same defense-in-depth as /hr.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { formatCalendarRange } from '@/lib/dates/calendarDate'
import { PeriodStatusChip } from '@/components/payroll/PeriodStatusChip'
import type { PayPeriodStatus } from '@prisma/client'

interface PeriodRow {
  id: string
  startDate: string
  endDate: string
  status: PayPeriodStatus
  note: string | null
  entryCount: number
  lockedAt: string | null
  exportedAt: string | null
}

export default function PayrollPage() {
  const [periods, setPeriods] = useState<PeriodRow[] | null>(null)
  const [suggested, setSuggested] = useState<{ startDate: string; endDate: string } | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ startDate: '', endDate: '' })

  const load = useCallback(async () => {
    const res = await fetch('/api/payroll/periods')
    if (res.status === 403 || res.status === 401) { setForbidden(true); return }
    if (!res.ok) { setError('Could not load pay periods.'); return }
    const data = await res.json()
    setPeriods(data.periods)
    setSuggested(data.suggested)
    setForm((f) => (f.startDate ? f : data.suggested))
  }, [])

  useEffect(() => { void load() }, [load])

  async function create() {
    setCreating(true)
    setError(null)
    const res = await fetch('/api/payroll/periods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setCreating(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Could not create the period.')
      return
    }
    setShowNew(false)
    await load()
  }

  if (forbidden) {
    return (
      <div className="bg-lt-page -m-3 md:-m-4 p-4 md:p-6 min-h-[calc(100vh-3rem)]">
        <div className="max-w-2xl mx-auto bg-lt-card border border-lt-hairline rounded-xl p-8">
          <h1 className="text-xl font-semibold text-lt-fg">Forbidden</h1>
          <p className="text-sm text-lt-fg2 mt-2">
            Payroll is restricted to a small allowlist. If you need access,
            contact Wes — adding a name requires a code review + deploy by
            design.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-lt-page -m-3 md:-m-4 p-4 md:p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1000px] mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-lt-fg">Payroll</h1>
            <p className="text-sm text-lt-fg2 mt-1">
              {periods == null
                ? 'Loading…'
                : `${periods.length} pay period${periods.length === 1 ? '' : 's'} · hours only, exported to ADP as CSV`}
            </p>
          </div>
          <button
            onClick={() => { setShowNew((v) => !v); if (suggested) setForm(suggested) }}
            className="rounded-lg bg-lt-fg text-white text-sm font-medium px-3.5 py-2 hover:opacity-90"
          >
            {showNew ? 'Cancel' : '+ New period'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg/30 text-chip-bad-fg text-sm px-4 py-2">
            {error}
          </div>
        )}

        {showNew && (
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 md:p-5 space-y-3">
            <p className="text-sm text-lt-fg2">
              Defaults to the two Saturday–Friday workweeks that just finished.
              Overtime is figured per workweek, so keep the boundaries on a
              Saturday unless something changed.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <label className="flex-1 text-xs text-lt-fg2">
                Start (Saturday)
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg"
                />
              </label>
              <label className="flex-1 text-xs text-lt-fg2">
                End (Friday)
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg"
                />
              </label>
            </div>
            <button
              onClick={create}
              disabled={creating || !form.startDate || !form.endDate}
              className="rounded-lg bg-lt-fg text-white text-sm font-medium px-3.5 py-2 disabled:opacity-40"
            >
              {creating ? 'Creating…' : 'Create period'}
            </button>
          </div>
        )}

        {periods && periods.length === 0 && (
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-sm text-lt-fg2">
            No pay periods yet. Create one above.
          </div>
        )}

        <div className="space-y-2">
          {periods?.map((p) => (
            <Link
              key={p.id}
              href={`/payroll/${p.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-lt-card border border-lt-hairline rounded-xl px-4 py-3.5 hover:border-lt-fg3 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-lt-fg">
                  {formatCalendarRange(p.startDate, p.endDate)}
                </div>
                <div className="text-xs text-lt-fg2 mt-0.5">
                  {p.entryCount === 0
                    ? 'nothing keyed yet'
                    : `${p.entryCount} day${p.entryCount === 1 ? '' : 's'} keyed`}
                  {p.exportedAt && ` · exported ${new Date(p.exportedAt).toLocaleDateString()}`}
                </div>
              </div>
              <PeriodStatusChip status={p.status} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
