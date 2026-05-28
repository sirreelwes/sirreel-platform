'use client'

/**
 * /warehouse/pick/[id] — the picking floor.
 *
 * One PickList at a time. Shows order context up top + an items grid.
 * Status-driven CTAs:
 *   DRAFT          → "Start picking" (DRAFT → PICKING)
 *   PICKING        → scan input + per-item check/scan, "Complete
 *                    picking" once nothing is PENDING_PICK
 *   READY_TO_STAGE → "Stage" (READY_TO_STAGE → STAGED, bulk PICKED→STAGED)
 *   STAGED         → "Load" (STAGED → LOADED, bulk STAGED→LOADED)
 *   LOADED         → terminal display only
 *
 * Scan input matches the typed/scanned code against the items'
 * inventoryItem.code values. First exact-match PENDING_PICK item gets
 * picked; everything else surfaces a mismatch toast. Manual override
 * checkbox per item covers no-SKU lines and scanner-down fallback.
 *
 * Tablet-friendly: large tap targets, scan input auto-focuses on load
 * and after each successful pick.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type ListStatus = 'DRAFT' | 'PICKING' | 'READY_TO_STAGE' | 'STAGED' | 'LOADED' | 'CANCELLED'
type LineStatus = 'PENDING_PICK' | 'PICKED' | 'STAGED' | 'LOADED'

interface PickItem {
  id: string
  scannedCode: string | null
  pickedAt: string | null
  pickedBy: { id: string; name: string } | null
  orderLineItem: {
    id: string
    sortOrder: number
    description: string
    quantity: number
    department: string
    pickStatus: LineStatus | null
    inventoryItem: { id: string; code: string; description: string | null } | null
  }
}

interface PickListDetail {
  id: string
  status: ListStatus
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
  items: PickItem[]
}

const STATUS_BADGE: Record<ListStatus, string> = {
  DRAFT:          'bg-zinc-800 text-zinc-300 border-zinc-700',
  PICKING:        'bg-amber-900/40 text-amber-300 border-amber-800',
  READY_TO_STAGE: 'bg-blue-900/40 text-blue-300 border-blue-800',
  STAGED:         'bg-indigo-900/40 text-indigo-300 border-indigo-800',
  LOADED:         'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  CANCELLED:      'bg-red-900/40 text-red-300 border-red-800',
}

const LINE_BADGE: Record<LineStatus, string> = {
  PENDING_PICK: 'bg-zinc-800 text-zinc-300',
  PICKED:       'bg-amber-900/40 text-amber-300',
  STAGED:       'bg-blue-900/40 text-blue-300',
  LOADED:       'bg-emerald-900/40 text-emerald-300',
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function WarehousePickDetailPage() {
  const params = useParams()
  const id = params?.id as string

  const [picklist, setPicklist] = useState<PickListDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [scanInput, setScanInput] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const scanRef = useRef<HTMLInputElement | null>(null)

  const fetchOne = async () => {
    setError(null)
    try {
      const r = await fetch(`/api/picklists/${id}`, { cache: 'no-store' })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(json?.error || `HTTP ${r.status}`)
        return
      }
      setPicklist(json.picklist)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'fetch failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!id) return
    fetchOne()
  }, [id])

  // Auto-focus the scan input when the list is in PICKING. Also after
  // each scan completes so the picker doesn't have to re-click.
  useEffect(() => {
    if (picklist?.status === 'PICKING' && scanRef.current) {
      scanRef.current.focus()
    }
  }, [picklist?.status, picklist?.items])

  // Auto-clear toast after a beat.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const counts = useMemo(() => {
    const c = { PENDING_PICK: 0, PICKED: 0, STAGED: 0, LOADED: 0 }
    if (!picklist) return c
    for (const i of picklist.items) {
      const s = i.orderLineItem.pickStatus
      if (s && s in c) c[s] += 1
    }
    return c
  }, [picklist])

  // Status-driven primary action handler. Each call POSTs to the
  // corresponding transition endpoint then re-fetches the detail.
  const runTransition = async (path: string, label: string) => {
    if (busyAction) return
    setBusyAction(label)
    try {
      const r = await fetch(`/api/picklists/${id}/${path}`, { method: 'POST' })
      const json = await r.json().catch(() => ({}))
      if (!r.ok || !json.ok) {
        setToast({ kind: 'err', msg: json?.reason || json?.error || `HTTP ${r.status}` })
        return
      }
      await fetchOne()
    } finally {
      setBusyAction(null)
    }
  }

  const handleScan = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const code = scanInput.trim()
    if (!code || !picklist) return
    // Find the FIRST PENDING_PICK item whose linked inventoryItem.code
    // matches. Multiple lines for the same SKU pick one at a time.
    const target = picklist.items.find(
      (i) =>
        i.orderLineItem.pickStatus === 'PENDING_PICK' &&
        i.orderLineItem.inventoryItem?.code === code,
    )
    if (!target) {
      // Scope the error: is the code on the list at all?
      const onList = picklist.items.some((i) => i.orderLineItem.inventoryItem?.code === code)
      setToast({
        kind: 'err',
        msg: onList ? `All ${code} on this list already picked.` : `${code} isn't on this list.`,
      })
      return
    }
    await pickItem(target.id, { scannedCode: code })
    setScanInput('')
  }

  const pickItem = async (itemId: string, body: { scannedCode?: string; manualOverride?: true }) => {
    if (busyAction) return
    setBusyAction(`pick:${itemId}`)
    try {
      const r = await fetch(`/api/picklists/${id}/items/${itemId}/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok || !json.ok) {
        setToast({ kind: 'err', msg: json?.reason || json?.error || `HTTP ${r.status}` })
        return
      }
      setToast({ kind: 'ok', msg: 'Picked.' })
      await fetchOne()
    } finally {
      setBusyAction(null)
    }
  }

  if (loading) return <div className="p-6 text-sm text-zinc-500">Loading…</div>
  if (error) return <div className="p-6 text-sm text-rose-400">{error}</div>
  if (!picklist) return <div className="p-6 text-sm text-zinc-500">Not found.</div>

  const allPicked = counts.PENDING_PICK === 0 && picklist.items.length > 0

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <Link href="/warehouse/pick" className="text-xs text-zinc-500 hover:text-zinc-300">
        ← Back to queue
      </Link>

      {/* Header */}
      <div className="mt-3 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/orders/${picklist.order.id}`}
                className="font-mono text-[12px] text-zinc-400 hover:text-amber-500"
              >
                {picklist.order.orderNumber}
              </Link>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${STATUS_BADGE[picklist.status]}`}>
                {picklist.status.replace('_', ' ')}
              </span>
              {picklist.assignedTo && (
                <span className="text-[11px] text-zinc-400">· assigned to {picklist.assignedTo.name}</span>
              )}
            </div>
            <h1 className="text-xl font-semibold text-white mt-1">
              {picklist.order.company.name}
              {picklist.order.job && <span className="text-zinc-500 font-normal"> · {picklist.order.job.name}</span>}
            </h1>
            <div className="text-[12px] text-zinc-500 mt-1">
              Pickup {fmtDate(picklist.order.startDate)} → return {fmtDate(picklist.order.endDate)}
            </div>
          </div>

          {/* Status-driven primary CTA */}
          <div className="flex-none">
            {picklist.status === 'DRAFT' && (
              <button
                onClick={() => runTransition('start', 'start')}
                disabled={busyAction != null}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {busyAction === 'start' ? 'Starting…' : 'Start picking →'}
              </button>
            )}
            {picklist.status === 'PICKING' && (
              <button
                onClick={() => runTransition('complete-picking', 'complete')}
                disabled={busyAction != null || !allPicked}
                title={!allPicked ? `${counts.PENDING_PICK} item(s) still pending` : undefined}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === 'complete' ? 'Submitting…' : 'Complete picking →'}
              </button>
            )}
            {picklist.status === 'READY_TO_STAGE' && (
              <button
                onClick={() => runTransition('stage', 'stage')}
                disabled={busyAction != null}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {busyAction === 'stage' ? 'Staging…' : 'Stage →'}
              </button>
            )}
            {picklist.status === 'STAGED' && (
              <button
                onClick={() => runTransition('load', 'load')}
                disabled={busyAction != null}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {busyAction === 'load' ? 'Loading…' : 'Load →'}
              </button>
            )}
            {picklist.status === 'LOADED' && (
              <div className="text-xs text-emerald-400 font-medium">Loaded {fmtDate(picklist.completedAt)}</div>
            )}
          </div>
        </div>

        {/* Counts strip */}
        <div className="grid grid-cols-4 gap-3 mt-4 text-center text-xs">
          <Count label="Pending"  n={counts.PENDING_PICK} highlight={counts.PENDING_PICK > 0 && picklist.status === 'PICKING'} />
          <Count label="Picked"   n={counts.PICKED} />
          <Count label="Staged"   n={counts.STAGED} />
          <Count label="Loaded"   n={counts.LOADED} />
        </div>
      </div>

      {/* Scan input — visible only while PICKING */}
      {picklist.status === 'PICKING' && (
        <form onSubmit={handleScan} className="mt-4 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Scan or type a code</label>
          <input
            ref={scanRef}
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            placeholder="e.g. SR-CST-001"
            autoFocus
            className="mt-1 w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-base text-white font-mono outline-none focus:border-amber-500"
            disabled={busyAction != null}
          />
        </form>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            toast.kind === 'ok'
              ? 'border-emerald-800 bg-emerald-950/50 text-emerald-200'
              : 'border-rose-800 bg-rose-950/50 text-rose-200'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Items grid */}
      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800 overflow-hidden">
        {picklist.items.length === 0 ? (
          <div className="p-6 text-sm text-zinc-500 text-center">No items on this list.</div>
        ) : (
          picklist.items.map((i) => {
            const li = i.orderLineItem
            const status: LineStatus = (li.pickStatus ?? 'PENDING_PICK') as LineStatus
            const canManualPick = picklist.status === 'PICKING' && status === 'PENDING_PICK'
            const isBusy = busyAction === `pick:${i.id}`
            return (
              <div key={i.id} className="p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${LINE_BADGE[status]}`}>
                      {status.replace('_', ' ')}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-500">
                      {li.inventoryItem?.code ?? '—'}
                    </span>
                    <span className="text-[11px] text-zinc-500">qty {li.quantity}</span>
                    {i.pickedBy && status !== 'PENDING_PICK' && (
                      <span className="text-[11px] text-zinc-500">· {i.pickedBy.name}</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-zinc-100">{li.description}</div>
                  {i.scannedCode && (
                    <div className="mt-0.5 text-[11px] text-zinc-500">scanned {i.scannedCode}</div>
                  )}
                </div>
                {canManualPick && (
                  <button
                    onClick={() => pickItem(i.id, { manualOverride: true })}
                    disabled={busyAction != null}
                    title={li.inventoryItem ? 'Bypass scan and mark picked' : 'No scannable code on this line'}
                    className="flex-none text-xs font-semibold border border-zinc-700 text-zinc-200 hover:border-amber-500 hover:text-amber-300 px-3 py-2 rounded-lg disabled:opacity-40"
                  >
                    {isBusy ? 'Picking…' : 'Manual ✓'}
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function Count({ label, n, highlight = false }: { label: string; n: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${highlight ? 'border-amber-700 bg-amber-950/30' : 'border-zinc-800 bg-zinc-950'}`}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</div>
      <div className={`text-lg font-bold ${highlight ? 'text-amber-300' : 'text-zinc-200'}`}>{n}</div>
    </div>
  )
}
