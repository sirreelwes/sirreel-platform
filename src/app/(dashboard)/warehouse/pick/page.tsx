'use client'

/**
 * /warehouse/pick — warehouse picking queue.
 *
 * Lists open PickLists (DRAFT / PICKING / READY_TO_STAGE / STAGED) so
 * the floor picker can pick the next one to work. Sorted by the
 * order's pickup date ascending — what physically ships next is on
 * top. Toggle "Show completed" to reveal LOADED + CANCELLED lists.
 *
 * Each row shows order #, company, pickup window, item count,
 * per-status counts, current list status, and who (if anyone) is
 * actively assigned. Click any row to open the detail view.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface QueueItem {
  id: string
  status: 'DRAFT' | 'PICKING' | 'READY_TO_STAGE' | 'STAGED' | 'LOADED' | 'CANCELLED'
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  assignedTo: { id: string; name: string } | null
  order: {
    id: string
    orderNumber: string
    startDate: string | null
    endDate: string | null
    company: { id: string; name: string }
    job: { id: string; jobCode: string; name: string } | null
  }
  itemCount: number
  counts: { PENDING_PICK: number; PICKED: number; STAGED: number; LOADED: number }
}

const STATUS_BADGE: Record<QueueItem['status'], string> = {
  DRAFT:          'bg-zinc-800 text-zinc-300 border-zinc-700',
  PICKING:        'bg-amber-900/40 text-amber-300 border-amber-800',
  READY_TO_STAGE: 'bg-blue-900/40 text-blue-300 border-blue-800',
  STAGED:         'bg-indigo-900/40 text-indigo-300 border-indigo-800',
  LOADED:         'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  CANCELLED:      'bg-red-900/40 text-red-300 border-red-800',
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function WarehousePickQueuePage() {
  const [picklists, setPicklists] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [includeTerminal, setIncludeTerminal] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPicklists(null)
    setError(null)
    const url = includeTerminal ? '/api/picklists?includeTerminal=1' : '/api/picklists'
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const json = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) {
          setError(json?.error || `HTTP ${r.status}`)
          setPicklists([])
        } else {
          setPicklists(json.picklists ?? [])
        }
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'fetch failed')
        setPicklists([])
      })
    return () => {
      cancelled = true
    }
  }, [includeTerminal])

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-white">Picking Queue</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Warehouse lane — picks by pickup date.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-300 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={includeTerminal}
            onChange={(e) => setIncludeTerminal(e.target.checked)}
            className="accent-amber-500"
          />
          Show completed
        </label>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-800 bg-rose-950/50 text-rose-200 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {picklists === null ? (
        <div className="text-sm text-zinc-500 py-12 text-center">Loading…</div>
      ) : picklists.length === 0 ? (
        <div className="text-sm text-zinc-500 py-12 text-center border border-dashed border-zinc-800 rounded-xl">
          {includeTerminal
            ? 'No pick lists yet.'
            : 'Nothing to pick. New pick lists appear here as orders get booked.'}
        </div>
      ) : (
        <div className="space-y-2">
          {picklists.map((p) => {
            const done = p.counts.PICKED + p.counts.STAGED + p.counts.LOADED
            const pct = p.itemCount > 0 ? Math.round((done / p.itemCount) * 100) : 0
            return (
              <Link
                key={p.id}
                href={`/warehouse/pick/${p.id}`}
                className="block bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition-colors"
              >
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[12px] text-zinc-500">{p.order.orderNumber}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${STATUS_BADGE[p.status]}`}>
                        {p.status.replace('_', ' ')}
                      </span>
                      {p.assignedTo && (
                        <span className="text-[11px] text-zinc-400">· {p.assignedTo.name}</span>
                      )}
                    </div>
                    <div className="mt-1 font-semibold text-white truncate">
                      {p.order.company.name}
                      {p.order.job && <span className="text-zinc-500 font-normal"> · {p.order.job.name}</span>}
                    </div>
                    <div className="mt-1 text-[12px] text-zinc-500">
                      Pickup {fmtDate(p.order.startDate)} → return {fmtDate(p.order.endDate)}
                      {' · '}
                      {p.itemCount} item{p.itemCount === 1 ? '' : 's'}
                      {p.counts.PENDING_PICK > 0 && <span className="text-amber-400"> · {p.counts.PENDING_PICK} pending</span>}
                    </div>
                  </div>
                  <div className="flex-none min-w-[110px] text-right">
                    <div className="text-xs text-zinc-500 mb-1">{pct}% done</div>
                    <div className="w-[110px] h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
