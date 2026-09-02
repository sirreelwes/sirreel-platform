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
 *   LOADED         → "Start check-in" (opens the inbound pass)
 *   CHECKING_IN    → per-item counted-back entry, "Complete check-in"
 *                    once every line has a count
 *   CHECKED_IN     → terminal display, with the shortfall summary
 *
 * Scan input POSTs the raw keystrokes to /api/picklists/[id]/scan and
 * lets the server work out what they mean (barcode phase 2). It used to
 * match against inventoryItem.code here in the browser — which is all it
 * COULD do, and is why scanning a real label failed: the labels on the
 * gear carry a per-unit RW barcode (SR004674) that only resolves against
 * the mirrored unit register. The server resolves either form and comes
 * back with a reason when the scan lands on nothing. Manual override
 * checkbox per item still covers no-SKU lines and scanner-down fallback.
 *
 * The inbound pass counts the SAME list back. It exists because LOADED
 * used to be terminal: included accessories — the spare batteries and
 * charging banks that ride along free with walkies — went out on a
 * scannable line and came back against nothing at all. A line whose
 * count is short is flagged with what it would cost to replace; nothing
 * is billed automatically.
 *
 * Tablet-friendly: large tap targets, scan input auto-focuses on load
 * and after each successful pick.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type ListStatus =
  | 'DRAFT'
  | 'PICKING'
  | 'READY_TO_STAGE'
  | 'STAGED'
  | 'LOADED'
  | 'CHECKING_IN'
  | 'CHECKED_IN'
  | 'CANCELLED'
type LineStatus = 'PENDING_PICK' | 'PICKED' | 'STAGED' | 'LOADED' | 'RETURNED' | 'SHORT'

interface PickItem {
  id: string
  scannedCode: string | null
  pickedAt: string | null
  pickedBy: { id: string; name: string } | null
  /** NULL = nobody has counted this line yet. Distinct from 0, which
   *  means a checker looked and none of it came back. */
  qtyReturned: number | null
  returnedAt: string | null
  returnNote: string | null
  returnedBy: { id: string; name: string } | null
  orderLineItem: {
    id: string
    sortOrder: number
    description: string
    quantity: number
    department: string
    pickStatus: LineStatus | null
    /** Set = an included accessory, not something the client ordered. */
    autoKitPieceId: string | null
    parentLineItemId: string | null
    inventoryItem: {
      id: string
      code: string
      description: string | null
      replacementCost: string | null
    } | null
  }
}

interface PickListDetail {
  id: string
  status: ListStatus
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  checkInStartedAt: string | null
  checkedInAt: string | null
  assignedTo: { id: string; name: string } | null
  checkedInBy: { id: string; name: string } | null
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
  CHECKING_IN:    'bg-sky-900/40 text-sky-300 border-sky-800',
  CHECKED_IN:     'bg-teal-900/40 text-teal-300 border-teal-800',
  CANCELLED:      'bg-red-900/40 text-red-300 border-red-800',
}


/**
 * Calendar dates (pickup, return, due) — UTC, never local.
 *
 * Separate from fmtDate() on purpose: that one also renders INSTANTS
 * (createdAt, signedAt, …) where local time is correct. Pinning it to UTC
 * would fix the rental dates and break the timestamps. See
 * src/lib/dates/calendarDate.ts.
 */
function fmtDay(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { ...{ month: 'short', day: 'numeric', year: 'numeric' }, timeZone: 'UTC' })
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
    const c = { PENDING_PICK: 0, PICKED: 0, STAGED: 0, LOADED: 0, RETURNED: 0, SHORT: 0 }
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
    if (!code || !picklist || busyAction) return
    setBusyAction('scan')
    try {
      const r = await fetch(`/api/picklists/${id}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok || !json.ok) {
        // The server's `reason` is written for someone standing at a
        // shelf holding the thing — show it verbatim rather than
        // re-phrasing it into a generic failure.
        setToast({ kind: 'err', msg: json?.reason || json?.error || `HTTP ${r.status}` })
        // Keep the text so a mis-read can be corrected instead of
        // retyped; select-all happens on the next keystroke naturally.
        return
      }
      // Name what was picked. A barcode pick echoes the gear, not the
      // number — the picker already knows the number, they just read it.
      const m = json.matched ?? {}
      setToast({
        kind: 'ok',
        msg: json.resolution === 'unit'
          ? `Picked ${m.description || m.barcode}.`
          : `Picked ${m.code || json.item?.description || 'item'}.`,
      })
      setScanInput('')
      await fetchOne()
    } finally {
      setBusyAction(null)
    }
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

  /** Count one line back in. `note` is mandatory server-side when the
   *  count is short — the UI collects it in the same prompt rather than
   *  bouncing the checker back with a 400. */
  const returnItem = async (item: PickItem, qtyReturned: number) => {
    if (busyAction) return
    const expected = item.orderLineItem.quantity
    let note = ''
    if (qtyReturned < expected) {
      const missing = expected - qtyReturned
      const answer = window.prompt(
        `${missing} of ${expected} × ${item.orderLineItem.description} did not come back.\n\nWhat happened? (this is what the person billing the client reads)`,
        '',
      )
      if (answer === null) return
      note = answer.trim()
      if (!note) {
        setToast({ kind: 'err', msg: 'A short count needs a note.' })
        return
      }
    }
    setBusyAction(`return:${item.id}`)
    try {
      const r = await fetch(`/api/picklists/${id}/items/${item.id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qtyReturned, note: note || undefined }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok || !json.ok) {
        setToast({ kind: 'err', msg: json?.reason || json?.error || `HTTP ${r.status}` })
        return
      }
      setToast(
        json.missing > 0
          ? { kind: 'err', msg: `Logged short ${json.missing}. Flagged on the order.` }
          : { kind: 'ok', msg: 'All back.' },
      )
      await fetchOne()
    } finally {
      setBusyAction(null)
    }
  }

  if (loading) return <div className="p-6 text-sm text-zinc-500">Loading…</div>
  if (error) return <div className="p-6 text-sm text-rose-400">{error}</div>
  if (!picklist) return <div className="p-6 text-sm text-zinc-500">Not found.</div>

  const allPicked = counts.PENDING_PICK === 0 && picklist.items.length > 0
  const uncountedCount = picklist.items.filter((i) => i.qtyReturned == null).length
  const allCounted = uncountedCount === 0 && picklist.items.length > 0
  const shortCount = picklist.items.filter(
    (i) => i.qtyReturned != null && i.qtyReturned < i.orderLineItem.quantity,
  ).length
  const checkingIn = picklist.status === 'CHECKING_IN'
  const checkedIn = picklist.status === 'CHECKED_IN'

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
                {picklist.status.replaceAll('_', ' ')}
              </span>
              {picklist.assignedTo && (
                <span className="text-[11px] text-zinc-400">· assigned to {picklist.assignedTo.name}</span>
              )}
            </div>
            <h1 className="text-xl font-semibold text-zinc-900 mt-1">
              {picklist.order.company.name}
              {picklist.order.job && <span className="text-zinc-500 font-normal"> · {picklist.order.job.name}</span>}
            </h1>
            <div className="text-[12px] text-zinc-500 mt-1">
              Pickup {fmtDay(picklist.order.startDate)} → return {fmtDay(picklist.order.endDate)}
            </div>
          </div>

          {/* Status-driven primary CTA + printable pick list */}
          <div className="flex-none flex flex-col items-end gap-2">
            <a
              href={`/api/orders/${picklist.order.id}/pick-list-pdf`}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-zinc-400 hover:text-amber-500"
            >
              Print pick list ↗
            </a>
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
              <>
                <div className="text-xs text-emerald-400 font-medium">Loaded {fmtDate(picklist.completedAt)}</div>
                <button
                  onClick={() => runTransition('check-in', 'checkin')}
                  disabled={busyAction != null}
                  className="px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                >
                  {busyAction === 'checkin' ? 'Opening…' : 'Start check-in →'}
                </button>
              </>
            )}
            {checkingIn && (
              <button
                onClick={() => runTransition('complete-check-in', 'completeCheckin')}
                disabled={busyAction != null || !allCounted}
                title={!allCounted ? `${uncountedCount} line(s) not counted yet` : undefined}
                className="px-4 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold rounded-lg disabled:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === 'completeCheckin' ? 'Closing…' : 'Complete check-in →'}
              </button>
            )}
            {checkedIn && (
              <div className="text-right">
                <div className="text-xs text-teal-400 font-medium">
                  Checked in {fmtDate(picklist.checkedInAt)}
                </div>
                {picklist.checkedInBy && (
                  <div className="text-[11px] text-zinc-500">by {picklist.checkedInBy.name}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Counts strip */}
        {/* Counts strip. The inbound pass replaces the outbound
            counters rather than adding to them — a checker counting
            gear back has no use for how many were staged. */}
        {checkingIn || checkedIn ? (
          <div className="grid grid-cols-3 gap-3 mt-4 text-center text-xs">
            <Count label="To count" n={uncountedCount} highlight={uncountedCount > 0 && checkingIn} />
            <Count label="All back" n={counts.RETURNED} />
            <Count label="Short"    n={shortCount} alert={shortCount > 0} />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-center text-xs">
            <Count label="Pending"  n={counts.PENDING_PICK} highlight={counts.PENDING_PICK > 0 && picklist.status === 'PICKING'} />
            <Count label="Picked"   n={counts.PICKED} />
            <Count label="Staged"   n={counts.STAGED} />
            <Count label="Loaded"   n={counts.LOADED} />
          </div>
        )}
      </div>

      {/* Scan input — visible only while PICKING */}
      {picklist.status === 'PICKING' && (
        <form onSubmit={handleScan} className="mt-4 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Scan a barcode, or type an item code</label>
          <input
            ref={scanRef}
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            placeholder="scan a barcode (SR004674) or type an item code"
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
            const isPicked = status !== 'PENDING_PICK'
            // An included accessory — the client never ordered it and was
            // never billed for it, which is exactly the gear that used to
            // walk off with no record. Badged so the checker knows.
            const isAccessory = !!li.autoKitPieceId
            const counted = i.qtyReturned != null
            const missing = counted ? li.quantity - (i.qtyReturned ?? 0) : 0
            const isShort = counted && missing > 0
            const returnBusy = busyAction === `return:${i.id}`
            const unitCost = li.inventoryItem?.replacementCost
            // Catalog name from InventoryItem.description (canonical, the
            // catalog admin-set "Surveillance Kit"-style name). Fall back
            // to the OrderLineItem.description (what sales typed) only
            // when there's no inventory link — kit-only lines, custom
            // entries, etc.
            const primaryName = li.inventoryItem?.description || li.description
            const skuCode = li.inventoryItem?.code ?? null
            // Whole row dims when picked so remaining pending rows
            // dominate the scan. The qty chip + name stay legible —
            // we drop the row opacity, not the text contrast itself.
            const rowOpacityCls =
              checkingIn || checkedIn ? (counted && !isShort ? 'opacity-60' : '') : isPicked ? 'opacity-60' : ''
            // Qty chip is the dominant scanning column. Amber when
            // pending (eye-grabbing), emerald when picked (calm done
            // state). Big number, tiny "Qty" kicker.
            const qtyChipCls =
              checkingIn || checkedIn
                ? isShort
                  ? 'bg-rose-950/60 border-rose-700/60 text-rose-300'
                  : counted
                    ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300'
                    : 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                : isPicked
                  ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
            return (
              <div key={i.id} className={`p-5 flex items-center gap-4 sm:gap-5 ${rowOpacityCls}`}>
                {/* QTY CHIP — dominant left column. Big number, tiny
                    label, fixed width so the eye scans straight down
                    the list. */}
                <div
                  className={`flex-none w-20 sm:w-24 rounded-xl border flex flex-col items-center justify-center py-3 ${qtyChipCls}`}
                >
                  <span className="text-[9px] uppercase tracking-[0.18em] font-bold opacity-70">
                    Qty
                  </span>
                  <span className="text-4xl font-bold leading-none tabular-nums mt-1">
                    {li.quantity}
                  </span>
                </div>

                {/* NAME + SKU stack — name big & white (catalog name),
                    SKU small mono dim under it for scan-matching. The
                    legacy "PENDING PICK" pill is gone — the whole
                    section IS pending until pick happens, so a per-row
                    pill was duplicative. */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-lg sm:text-xl font-bold leading-tight ${
                      isPicked ? 'text-zinc-400 line-through decoration-emerald-600/60 decoration-2' : 'text-white'
                    }`}
                  >
                    {primaryName}
                  </div>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    {skuCode && (
                      <span className="font-mono text-xs text-zinc-500 tracking-wide">{skuCode}</span>
                    )}
                    {isAccessory && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-violet-700/60 bg-violet-950/40 text-violet-300"
                        title="Included accessory — rides along with another line at no charge"
                      >
                        Included
                      </span>
                    )}
                  </div>
                  {isPicked && !counted && !checkingIn && !checkedIn && i.pickedBy && (
                    <div className="mt-1.5 text-[11px] text-emerald-400 flex items-center gap-1.5">
                      <span aria-hidden>✓</span>
                      <span>picked by {i.pickedBy.name}{i.scannedCode ? ` · scanned ${i.scannedCode}` : ''}</span>
                    </div>
                  )}
                  {counted && (
                    <div className="mt-1.5 text-[11px] flex flex-col gap-0.5">
                      <span className={isShort ? 'text-rose-400' : 'text-emerald-400'}>
                        {isShort
                          ? `${missing} of ${li.quantity} missing`
                          : `all ${li.quantity} back`}
                        {i.returnedBy ? ` · counted by ${i.returnedBy.name}` : ''}
                      </span>
                      {isShort && i.returnNote && (
                        <span className="text-zinc-400 italic">“{i.returnNote}”</span>
                      )}
                      {isShort && unitCost && (
                        <span className="text-zinc-500">
                          replacement ${(Number(unitCost) * missing).toFixed(2)}
                          {missing > 1 ? ` (${missing} × $${Number(unitCost).toFixed(2)})` : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* ACTION — large tap target (h ≥ 52px) so a gloved
                    picker at arm's length can hit it cleanly. Only
                    rendered while the row is pickable. */}
                {canManualPick && (
                  <button
                    onClick={() => pickItem(i.id, { manualOverride: true })}
                    disabled={busyAction != null}
                    title={li.inventoryItem ? 'Bypass scan and mark picked' : 'No scannable code on this line'}
                    className="flex-none min-h-[56px] px-5 sm:px-6 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-sm sm:text-base font-bold rounded-xl shadow-sm disabled:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                  >
                    {isBusy ? 'Picking…' : 'Mark picked'}
                  </button>
                )}
                {/* Picked rows get a calm emerald check in the action
                    slot so the row's shape stays consistent down the
                    list (no jitter as items flip pending → picked). */}
                {isPicked && !checkingIn && !checkedIn && (
                  <div
                    className="flex-none min-h-[56px] px-5 sm:px-6 flex items-center justify-center text-emerald-400"
                    aria-label="picked"
                  >
                    <span className="text-2xl leading-none" aria-hidden>✓</span>
                  </div>
                )}

                {/* INBOUND — count this line back. "All back" is one tap
                    because it is the answer nine times out of ten; the
                    short path opens a count entry, because a checker who
                    has to type the common case stops counting carefully. */}
                {checkingIn && !counted && (
                  <div className="flex-none flex items-center gap-2">
                    <button
                      onClick={() => returnItem(i, li.quantity)}
                      disabled={busyAction != null}
                      className="min-h-[56px] px-4 sm:px-5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm sm:text-base font-bold rounded-xl shadow-sm disabled:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                    >
                      {returnBusy ? 'Saving…' : 'All back'}
                    </button>
                    <button
                      onClick={() => {
                        const answer = window.prompt(
                          `How many of the ${li.quantity} × ${li.description} came back?`,
                          String(li.quantity),
                        )
                        if (answer === null) return
                        const n = Number(answer.trim())
                        if (!Number.isInteger(n) || n < 0 || n > li.quantity) {
                          setToast({
                            kind: 'err',
                            msg: `Enter a whole number between 0 and ${li.quantity}.`,
                          })
                          return
                        }
                        returnItem(i, n)
                      }}
                      disabled={busyAction != null}
                      className="min-h-[56px] px-4 sm:px-5 border border-rose-800 bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 text-sm font-bold rounded-xl disabled:opacity-50 transition-colors"
                    >
                      Short…
                    </button>
                  </div>
                )}
                {(checkingIn || checkedIn) && counted && (
                  <div
                    className={`flex-none min-h-[56px] px-5 sm:px-6 flex items-center justify-center ${
                      isShort ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                    aria-label={isShort ? 'short' : 'returned'}
                  >
                    <span className="text-2xl leading-none" aria-hidden>{isShort ? '!' : '✓'}</span>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function Count({
  label,
  n,
  highlight = false,
  alert = false,
}: {
  label: string
  n: number
  highlight?: boolean
  /** Rose tone for a count that means something is missing. */
  alert?: boolean
}) {
  const tone = alert
    ? { box: 'border-rose-800 bg-rose-950/30', num: 'text-rose-300' }
    : highlight
      ? { box: 'border-amber-700 bg-amber-950/30', num: 'text-amber-300' }
      : { box: 'border-zinc-800 bg-zinc-950', num: 'text-zinc-200' }
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone.box}`}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</div>
      <div className={`text-lg font-bold ${tone.num}`}>{n}</div>
    </div>
  )
}
