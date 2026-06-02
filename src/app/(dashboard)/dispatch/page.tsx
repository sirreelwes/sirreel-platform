'use client'

/**
 * /dispatch — the staff dispatch board (Phase 4 commit 2).
 *
 * Read-only projection of the order lifecycle. Two-sided overdue band
 * (LATE TO SHIP / LATE TO RETURN) pinned full-width at the top, then
 * Today + Tomorrow columns each showing Outbound (FLEET cards above
 * WAREHOUSE cards) and Inbound.
 *
 * Wall-mounted display: large type, dense info per card, 60s auto-
 * refresh. Phone: stacks columns vertically, refreshes on load + on
 * window focus, no auto-refresh. Both use the same card components.
 *
 * Dark visual language mirrors /warehouse/pick exactly — same
 * bg-zinc-900 / border-zinc-800 cards, same status badge palette.
 *
 * Data source: GET /api/dispatch?asOf=today&days=2. Look-ahead toggle
 * (Commit 3) re-fetches with days=14.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type ListStatus = 'BOOKED' | 'LOADED_READY' | 'ON_JOB'
type PickListStatus =
  | 'DRAFT'
  | 'PICKING'
  | 'READY_TO_STAGE'
  | 'STAGED'
  | 'LOADED'
  | 'CANCELLED'
type Priority = 'URGENT' | 'HIGH' | 'STANDARD' | 'LOW'

interface FleetCard {
  kind: 'FLEET'
  cardId: string
  lineId: string
  orderId: string
  orderNumber: string
  status: ListStatus
  companyName: string
  jobName: string | null
  jobCode: string | null
  assetUnitName: string | null
  categoryName: string | null
  effectivePickupDate: string
  effectiveReturnDate: string
  priority: Priority | null
  // Blind handoff flags from the parent Order. blindReturn drives
  // the loud "needs check-in" inbound banner; blindPickup drives a
  // light marker on outbound for prep awareness.
  blindPickup: boolean
  blindReturn: boolean
}

interface WarehouseCard {
  kind: 'WAREHOUSE'
  cardId: string
  orderId: string
  orderNumber: string
  status: ListStatus
  companyName: string
  jobName: string | null
  jobCode: string | null
  lineCount: number
  effectivePickupDate: string
  effectiveReturnDate: string
  pickListStatus: PickListStatus | null
  priority: Priority | null
  blindPickup: boolean
  blindReturn: boolean
}

type DispatchCard = FleetCard | WarehouseCard

interface DispatchDay {
  date: string
  label: string
  outboundFleet: FleetCard[]
  outboundWarehouse: WarehouseCard[]
  inbound: DispatchCard[]
}

interface DispatchPayload {
  asOfDate: string
  horizonDays: number
  overdue: { lateToShip: DispatchCard[]; lateToReturn: DispatchCard[] }
  days: DispatchDay[]
}

const STATUS_COLOR: Record<ListStatus, string> = {
  BOOKED:       'bg-indigo-900/40 text-indigo-300 border-indigo-800',
  LOADED_READY: 'bg-teal-900/40 text-teal-300 border-teal-800',
  ON_JOB:       'bg-emerald-900/40 text-emerald-300 border-emerald-800',
}

const PICKLIST_COLOR: Record<PickListStatus, string> = {
  DRAFT:          'bg-zinc-800 text-zinc-300',
  PICKING:        'bg-amber-900/40 text-amber-300',
  READY_TO_STAGE: 'bg-blue-900/40 text-blue-300',
  STAGED:         'bg-indigo-900/40 text-indigo-300',
  LOADED:         'bg-emerald-900/40 text-emerald-300',
  CANCELLED:      'bg-red-900/40 text-red-300',
}

const PRIORITY_COLOR: Record<Priority, string> = {
  URGENT:   'bg-red-900/40 text-red-200 border-red-800',
  HIGH:     'bg-orange-900/40 text-orange-300 border-orange-800',
  STANDARD: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  LOW:      'bg-zinc-800 text-zinc-500 border-zinc-700',
}

function fmtDate(ymd: string): string {
  // Display-only. Card already has the day label in its column; this
  // is the per-card "return Tue 6/3" detail. Use UTC components since
  // server already normalized to YYYY-MM-DD.
  const d = new Date(`${ymd}T12:00:00Z`)
  if (isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
}

const REFRESH_MS = 60_000

type Horizon = 'soon' | 'fortnight'
const HORIZON_DAYS: Record<Horizon, number> = { soon: 2, fortnight: 14 }

export default function DispatchPage() {
  const [data, setData] = useState<DispatchPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null)
  const [horizon, setHorizon] = useState<Horizon>('soon')
  const isMobile = useIsMobile()

  const fetchData = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const r = await fetch(`/api/dispatch?days=${HORIZON_DAYS[horizon]}`, { cache: 'no-store' })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(json?.error || `HTTP ${r.status}`)
        return
      }
      setData(json as DispatchPayload)
      setLastFetchedAt(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed')
    } finally {
      setRefreshing(false)
    }
  }, [horizon])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-refresh: desktop/wall only (60s). Phone refreshes on focus +
  // manual refresh button.
  useEffect(() => {
    if (isMobile) return
    const id = window.setInterval(() => {
      void fetchData()
    }, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [isMobile, fetchData])

  // Focus-refresh on phone — when the page returns from background.
  useEffect(() => {
    const onFocus = () => {
      void fetchData()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchData])

  if (error) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 text-rose-200 text-sm px-3 py-2">{error}</div>
      </div>
    )
  }

  if (!data) {
    return <div className="p-6 text-sm text-zinc-500">Loading dispatch…</div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto overflow-x-hidden">
      <header className="flex items-baseline justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dispatch</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            As of {fmtDate(data.asOfDate)} · horizon {data.horizonDays} day{data.horizonDays === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500 flex-wrap justify-end">
          <HorizonToggle horizon={horizon} onChange={setHorizon} />
          {lastFetchedAt && (
            <span>refreshed {lastFetchedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
          )}
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="ml-1 border border-zinc-700 text-zinc-200 hover:border-zinc-500 px-2.5 py-1 rounded text-xs disabled:opacity-40"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <OverdueBand overdue={data.overdue} />

      {horizon === 'soon' ? (
        <DaysGrid days={data.days} />
      ) : (
        <LookAheadGrid days={data.days} />
      )}
    </div>
  )
}

function HorizonToggle({ horizon, onChange }: { horizon: Horizon; onChange: (h: Horizon) => void }) {
  return (
    <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden">
      {(['soon', 'fortnight'] as Horizon[]).map((h) => (
        <button
          key={h}
          onClick={() => onChange(h)}
          className={`px-2.5 py-1 text-xs font-medium ${
            horizon === h
              ? 'bg-zinc-700 text-white'
              : 'bg-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {h === 'soon' ? 'Today / Tomorrow' : 'Next 14 days'}
        </button>
      ))}
    </div>
  )
}

// ─── Overdue band ─────────────────────────────────────────────────
function OverdueBand({
  overdue,
}: {
  overdue: DispatchPayload['overdue']
}) {
  const lateShip = overdue.lateToShip.length
  const lateReturn = overdue.lateToReturn.length
  if (lateShip === 0 && lateReturn === 0) return null
  return (
    <div className="mb-6 rounded-xl border border-red-900/70 bg-red-950/40">
      <div className="px-4 py-2.5 border-b border-red-900/60 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-red-300">Overdue</span>
        <span className="text-[11px] text-red-400">
          {lateShip} late to ship · {lateReturn} late to return
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-red-900/60">
        <OverdueSection label="Late to ship" cards={overdue.lateToShip} />
        <OverdueSection label="Late to return" cards={overdue.lateToReturn} />
      </div>
    </div>
  )
}

function OverdueSection({ label, cards }: { label: string; cards: DispatchCard[] }) {
  return (
    <div className="p-3">
      <div className="text-[10px] uppercase tracking-wider font-bold text-red-300 mb-2">{label}</div>
      {cards.length === 0 ? (
        <div className="text-xs text-red-400/70">None ✓</div>
      ) : (
        <div className="grid gap-1.5">
          {cards.map((c) => (c.kind === 'FLEET' ? <FleetCardView key={c.cardId} c={c} overdue /> : <WarehouseCardView key={c.cardId} c={c} overdue />))}
        </div>
      )}
    </div>
  )
}

// ─── Days grid ────────────────────────────────────────────────────
function DaysGrid({ days }: { days: DispatchDay[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {days.map((d) => (
        <DayColumn key={d.date} day={d} />
      ))}
    </div>
  )
}

function DayColumn({ day }: { day: DispatchDay }) {
  const outTotal = day.outboundFleet.length + day.outboundWarehouse.length
  const inTotal = day.inbound.length
  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-baseline justify-between">
        <div>
          <h2 className="font-semibold text-white">{day.label}</h2>
          <div className="text-[11px] text-zinc-500 mt-0.5">{fmtDate(day.date)}</div>
        </div>
        <div className="text-[11px] text-zinc-500">
          {outTotal} out · {inTotal} in
        </div>
      </div>

      <SubSection
        label="Outbound"
        empty={outTotal === 0}
        emptyCopy="Nothing going out."
      >
        {day.outboundFleet.map((c) => <FleetCardView key={c.cardId} c={c} />)}
        {day.outboundWarehouse.map((c) => <WarehouseCardView key={c.cardId} c={c} />)}
      </SubSection>

      <SubSection
        label="Inbound"
        empty={inTotal === 0}
        emptyCopy="Nothing coming back."
      >
        {day.inbound.map((c) => (c.kind === 'FLEET' ? <FleetCardView key={c.cardId} c={c} /> : <WarehouseCardView key={c.cardId} c={c} />))}
      </SubSection>
    </section>
  )
}

function SubSection({
  label,
  empty,
  emptyCopy,
  children,
}: {
  label: string
  empty: boolean
  emptyCopy: string
  children: React.ReactNode
}) {
  return (
    <div className="px-3 py-3 border-b border-zinc-800 last:border-b-0">
      <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 mb-2 px-1">{label}</div>
      {empty ? (
        <div className="text-xs text-zinc-600 px-1 py-2">{emptyCopy}</div>
      ) : (
        <div className="grid gap-1.5">{children}</div>
      )}
    </div>
  )
}

// ─── Look-ahead grid ─────────────────────────────────────────────
function LookAheadGrid({ days }: { days: DispatchDay[] }) {
  // Heat accent: compute max per-day total across the horizon so the
  // visual emphasis is relative ("heavy days vs light days for *this*
  // horizon"), not absolute.
  const maxTotal = Math.max(
    1,
    ...days.map((d) => d.outboundFleet.length + d.outboundWarehouse.length + d.inbound.length),
  )
  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h2 className="font-semibold text-white">Daily load · {days.length} days</h2>
        <div className="text-[11px] text-zinc-500 mt-0.5">
          Tap a row to expand. Heat accent scales to the heaviest day in view.
        </div>
      </div>
      <div className="divide-y divide-zinc-800">
        {days.map((d) => (
          <LookAheadRow key={d.date} day={d} maxTotal={maxTotal} />
        ))}
      </div>
    </section>
  )
}

function LookAheadRow({ day, maxTotal }: { day: DispatchDay; maxTotal: number }) {
  const [expanded, setExpanded] = useState(false)
  const outFleet = day.outboundFleet.length
  const outWh = day.outboundWarehouse.length
  const inboundN = day.inbound.length
  const total = outFleet + outWh + inboundN
  const heat = Math.min(1, total / maxTotal)
  // Heat → alpha amber accent on the bar
  return (
    <div className="bg-zinc-950">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-zinc-900/60 transition-colors"
      >
        {/* Heat bar */}
        <div className="flex-none w-1.5 h-10 rounded overflow-hidden bg-zinc-900">
          <div className="w-full bg-amber-500" style={{ height: `${Math.round(heat * 100)}%`, marginTop: `${Math.round((1 - heat) * 100)}%` }} />
        </div>
        {/* Date */}
        <div className="flex-none min-w-[88px]">
          <div className="text-sm font-semibold text-white">{day.label}</div>
          <div className="text-[11px] text-zinc-500">{fmtDate(day.date)}</div>
        </div>
        {/* Counts strip */}
        <div className="flex-1 grid grid-cols-3 gap-2 text-center text-xs">
          <LoadStat label="Out FLEET" n={outFleet} color="zinc" />
          <LoadStat label="Out WHS"   n={outWh}    color="amber" />
          <LoadStat label="In"        n={inboundN} color="emerald" />
        </div>
        <div className="flex-none text-[11px] text-zinc-500">{expanded ? '−' : '+'}</div>
      </button>
      {expanded && total > 0 && (
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-zinc-800/60">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 mt-2 mb-2">Outbound</div>
            {outFleet + outWh === 0 ? (
              <div className="text-xs text-zinc-600">None.</div>
            ) : (
              <div className="grid gap-1.5">
                {day.outboundFleet.map((c) => <FleetCardView key={c.cardId} c={c} />)}
                {day.outboundWarehouse.map((c) => <WarehouseCardView key={c.cardId} c={c} />)}
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 mt-2 mb-2">Inbound</div>
            {inboundN === 0 ? (
              <div className="text-xs text-zinc-600">None.</div>
            ) : (
              <div className="grid gap-1.5">
                {day.inbound.map((c) => (c.kind === 'FLEET' ? <FleetCardView key={c.cardId} c={c} /> : <WarehouseCardView key={c.cardId} c={c} />))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LoadStat({ label, n, color }: { label: string; n: number; color: 'zinc' | 'amber' | 'emerald' }) {
  const palettes = {
    zinc:    { text: n > 0 ? 'text-zinc-200'    : 'text-zinc-600' },
    amber:   { text: n > 0 ? 'text-amber-300'   : 'text-zinc-600' },
    emerald: { text: n > 0 ? 'text-emerald-300' : 'text-zinc-600' },
  }
  return (
    <div className="rounded border border-zinc-800 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</div>
      <div className={`text-base font-bold ${palettes[color].text}`}>{n}</div>
    </div>
  )
}

// ─── Card views ───────────────────────────────────────────────────
// Blind-return alert: when an inbound (ON_JOB) card has blindReturn
// set, the unit is coming back without a SirReel rep present. The
// agent already typed the drop-off instructions, but ops still needs
// to physically check the unit in. The alert clears the moment ops
// marks the Order RETURNED (the card drops off the inbound lane).
function isInboundBlindReturn(c: { status: ListStatus; blindReturn: boolean }) {
  return c.status === 'ON_JOB' && c.blindReturn
}
// Outbound blind-pickup: lighter heads-up so the warehouse / fleet
// can stage the unit knowing nobody's coming for a face-to-face.
function isOutboundBlindPickup(c: { status: ListStatus; blindPickup: boolean }) {
  return (c.status === 'BOOKED' || c.status === 'LOADED_READY') && c.blindPickup
}

function FleetCardView({ c, overdue }: { c: FleetCard; overdue?: boolean }) {
  const blindReturn = isInboundBlindReturn(c)
  const blindPickup = isOutboundBlindPickup(c)
  return (
    <Link
      href={`/orders/${c.orderId}`}
      className={`block rounded-lg border transition-colors overflow-hidden ${
        blindReturn
          ? 'border-red-500 bg-red-950/40 hover:border-red-400 shadow-[0_0_0_1px_rgba(239,68,68,0.5)]'
          : overdue
            ? 'border-red-900/60 bg-red-950/30 hover:border-red-700'
            : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
      }`}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">FLEET</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${STATUS_COLOR[c.status]}`}>
            {c.status.replace('_', ' ')}
          </span>
          {c.priority && c.priority !== 'STANDARD' && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${PRIORITY_COLOR[c.priority]}`}>
              {c.priority}
            </span>
          )}
          {blindPickup && (
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-200 border border-amber-800/60"
              title="Blind pickup — client picks up the unit themselves; stage and leave per instructions"
            >
              ⊘↗ Blind pickup
            </span>
          )}
          <span className="font-mono text-[11px] text-zinc-500 ml-auto">{c.orderNumber}</span>
        </div>
        <div className="mt-1.5 font-semibold text-[14px] text-white leading-tight truncate">
          {c.assetUnitName || c.categoryName || 'Vehicle'}
        </div>
        <div className="mt-0.5 text-[12px] text-zinc-400 truncate">
          {c.companyName}
          {c.jobName && <span className="text-zinc-500"> · {c.jobName}</span>}
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          out {fmtDate(c.effectivePickupDate)} → in {fmtDate(c.effectiveReturnDate)}
        </div>
      </div>
      {blindReturn && (
        <div className="bg-red-600 text-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
          <span aria-hidden="true">⚠</span>
          Blind return — needs check-in
        </div>
      )}
    </Link>
  )
}

function WarehouseCardView({ c, overdue }: { c: WarehouseCard; overdue?: boolean }) {
  const blindReturn = isInboundBlindReturn(c)
  const blindPickup = isOutboundBlindPickup(c)
  return (
    <Link
      href={`/orders/${c.orderId}`}
      className={`block rounded-lg border transition-colors overflow-hidden ${
        blindReturn
          ? 'border-red-500 bg-red-950/40 hover:border-red-400 shadow-[0_0_0_1px_rgba(239,68,68,0.5)]'
          : overdue
            ? 'border-red-900/60 bg-red-950/30 hover:border-red-700'
            : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
      }`}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-300">WAREHOUSE</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${STATUS_COLOR[c.status]}`}>
            {c.status.replace('_', ' ')}
          </span>
          {c.pickListStatus && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${PICKLIST_COLOR[c.pickListStatus]}`}>
              {c.pickListStatus.replace('_', ' ')}
            </span>
          )}
          {c.priority && c.priority !== 'STANDARD' && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${PRIORITY_COLOR[c.priority]}`}>
              {c.priority}
            </span>
          )}
          {blindPickup && (
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-200 border border-amber-800/60"
              title="Blind pickup — client picks up the load themselves; stage and leave per instructions"
            >
              ⊘↗ Blind pickup
            </span>
          )}
          <span className="font-mono text-[11px] text-zinc-500 ml-auto">{c.orderNumber}</span>
        </div>
        <div className="mt-1.5 font-semibold text-[14px] text-white leading-tight truncate">
          {c.companyName}
          {c.jobName && <span className="text-zinc-400 font-normal"> · {c.jobName}</span>}
        </div>
        <div className="mt-0.5 text-[12px] text-zinc-400">
          {c.lineCount} line{c.lineCount === 1 ? '' : 's'}
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          out {fmtDate(c.effectivePickupDate)} → in {fmtDate(c.effectiveReturnDate)}
        </div>
      </div>
      {blindReturn && (
        <div className="bg-red-600 text-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
          <span aria-hidden="true">⚠</span>
          Blind return — needs check-in
        </div>
      )}
    </Link>
  )
}

// ─── Responsive hook ──────────────────────────────────────────────
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)
  const mqlRef = useRef<MediaQueryList | null>(null)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    mqlRef.current = mql
    setMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return mobile
}
