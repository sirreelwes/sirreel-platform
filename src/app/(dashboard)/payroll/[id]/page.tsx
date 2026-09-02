'use client'

/**
 * A pay period — the grid, the exceptions, lock, and export.
 *
 * Every number on this page is computed on the server by
 * src/lib/payroll/period.ts, the same function the CSV reads. The client
 * renders and posts edits; it never does the overtime math, so the screen an
 * admin approves and the file ADP receives cannot disagree.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { formatCalendarRange } from '@/lib/dates/calendarDate'
import { PeriodStatusChip } from '@/components/payroll/PeriodStatusChip'
import { ExceptionsStrip } from '@/components/payroll/ExceptionsStrip'
import { TimesheetGrid } from '@/components/payroll/TimesheetGrid'
import type { CellPatch, PeriodGrid } from '@/components/payroll/types'

export default function PayrollPeriodPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [grid, setGrid] = useState<PeriodGrid | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/payroll/periods/${id}`)
    if (res.status === 403 || res.status === 401) { setForbidden(true); return }
    if (!res.ok) { setError('Could not load this pay period.'); return }
    setGrid(await res.json())
  }, [id])

  useEffect(() => { void load() }, [load])

  /**
   * One cell, one request. The response IS the recomputed grid, so the weekly
   * Reg/OT/DT and the exceptions strip update as you type rather than after a
   * separate refresh — watching the overtime appear is how you catch a
   * mistyped out-time.
   */
  const onPatch = useCallback(async (employeeId: string, date: string, patch: CellPatch) => {
    setError(null)
    const res = await fetch(`/api/payroll/periods/${id}/entries`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, date, ...patch }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'That change did not save.')
      await load()
      return
    }
    setGrid(await res.json())
  }, [id, load])

  async function setStatus(status: 'DRAFT' | 'LOCKED', reopen = false) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/payroll/periods/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...(reopen ? { reopen: true } : {}) }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Could not change the status.')
      return
    }
    setGrid(await res.json())
  }

  /**
   * Downloading IS the export — the server stamps EXPORTED as it hands over
   * the file, so HQ's status and what ADP actually received stay in step.
   * The fetch-then-blob dance (rather than a plain link) is what lets us read
   * the error body when the server refuses.
   */
  async function exportCsv() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/payroll/periods/${id}/export`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Export failed.')
      setBusy(false)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sirreel-payroll-${grid?.startDate}-to-${grid?.endDate}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setBusy(false)
    await load()
  }

  if (forbidden) {
    return (
      <div className="bg-lt-page -m-3 md:-m-4 p-4 md:p-6 min-h-[calc(100vh-3rem)]">
        <div className="max-w-2xl mx-auto bg-lt-card border border-lt-hairline rounded-xl p-8">
          <h1 className="text-xl font-semibold text-lt-fg">Forbidden</h1>
          <p className="text-sm text-lt-fg2 mt-2">
            Payroll is restricted to a small allowlist.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-lt-page -m-3 md:-m-4 p-4 md:p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1600px] mx-auto space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/payroll" className="text-xs text-lt-fg2 hover:text-lt-fg">
              ← Payroll
            </Link>
            <div className="flex items-center gap-3 mt-1">
              <h1 className="text-2xl font-semibold text-lt-fg">
                {grid ? formatCalendarRange(grid.startDate, grid.endDate) : 'Loading…'}
              </h1>
              {grid && <PeriodStatusChip status={grid.status} />}
            </div>
            {grid && (
              <p className="text-sm text-lt-fg2 mt-1">
                {grid.rows.length} on the timesheet · overtime figured per Saturday–Friday week
                {grid.status !== 'DRAFT' && ' · read-only'}
              </p>
            )}
          </div>

          {grid && (
            <div className="flex flex-wrap gap-2">
              {grid.status === 'DRAFT' && (
                <button
                  onClick={() => setStatus('LOCKED')}
                  disabled={busy}
                  className="rounded-lg bg-lt-fg text-white text-sm font-medium px-3.5 py-2 disabled:opacity-40"
                >
                  Lock period
                </button>
              )}
              {grid.status === 'LOCKED' && (
                <>
                  <button
                    onClick={() => setStatus('DRAFT')}
                    disabled={busy}
                    className="rounded-lg border border-lt-hairline bg-lt-card text-sm font-medium text-lt-fg px-3.5 py-2 disabled:opacity-40"
                  >
                    Unlock
                  </button>
                  <button
                    onClick={exportCsv}
                    disabled={busy}
                    className="rounded-lg bg-lt-fg text-white text-sm font-medium px-3.5 py-2 disabled:opacity-40"
                  >
                    Export CSV for ADP
                  </button>
                </>
              )}
              {grid.status === 'EXPORTED' && (
                <>
                  <button
                    onClick={() => {
                      if (confirm('This period was already exported to ADP. Reopening makes that file stale — you will need to re-export and re-key. Continue?')) {
                        void setStatus('DRAFT', true)
                      }
                    }}
                    disabled={busy}
                    className="rounded-lg border border-lt-hairline bg-lt-card text-sm font-medium text-lt-fg px-3.5 py-2 disabled:opacity-40"
                  >
                    Reopen
                  </button>
                  <button
                    onClick={exportCsv}
                    disabled={busy}
                    className="rounded-lg border border-lt-hairline bg-lt-card text-sm font-medium text-lt-fg px-3.5 py-2 disabled:opacity-40"
                  >
                    Download again
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg/30 text-chip-bad-fg text-sm px-4 py-2">
            {error}
          </div>
        )}

        {grid?.status === 'DRAFT' && grid.exceptionCount === 0 && grid.totals.totalHrs === 0 && (
          <div className="rounded-lg border border-lt-hairline bg-lt-card text-sm text-lt-fg2 px-4 py-3">
            Nothing keyed yet. Type the In and Out times straight off the paper
            sheet — click the hours under a day for lunch, sick, PTO,
            adjustments or a meal premium.
          </div>
        )}

        {grid && <ExceptionsStrip rows={grid.rows} />}
        {grid && <TimesheetGrid grid={grid} onPatch={onPatch} />}
      </div>
    </div>
  )
}
