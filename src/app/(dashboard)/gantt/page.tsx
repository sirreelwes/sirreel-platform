'use client';

import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { useSession } from 'next-auth/react';
import type { UserRole } from '@prisma/client';
import Link from 'next/link';
import { NewHoldModal } from '@/components/scheduling/NewHoldModal';
import { AssignUnitsModal } from '@/components/scheduling/AssignUnitsModal';
import { AssignTaskModal } from '@/components/scheduling/AssignTaskModal';
import { AssetSummaryPanel } from '@/components/scheduling/AssetSummaryPanel';
import { ScheduleViewToggle } from '@/components/schedule/ScheduleViewToggle';
import { SCHEDULE_LABEL } from '@/lib/app-labels';
import { getPermissions } from '@/lib/permissions';

function toDS(d: Date): string { return d.toISOString().split('T')[0]; }
function addDays(ds: string, n: number): string { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return toDS(d); }
function diffDays(a: string, b: string): number { return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000); }
function fDay(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }); }
function fMonth(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
const today = toDS(new Date());

const CAT_COLORS: Record<string, string> = {
  cube: '#3b82f6', cargo: '#8b5cf6', pass: '#06b6d4', pop: '#f59e0b',
  cam: '#ec4899', dlux: '#10b981', scout: '#f97316', studio: '#6366f1',
  stakebed: '#78716c', general: '#9ca3af',
}

// Condition tier → left-of-name dot. Reuses the existing Asset.tier enum
// (PREMIUM/STANDARD/ECONOMY); Wes's mapping: Best=green, Good=orange,
// Workhorse=yellow. Category stays identifiable via the unit's label text.
const TIER_COLORS: Record<string, string> = {
  PREMIUM: '#22c55e',  // green — Best
  STANDARD: '#f97316', // orange — Good
  ECONOMY: '#eab308',  // yellow — Workhorse
}
const TIER_LABELS: Record<string, string> = {
  PREMIUM: 'Best', STANDARD: 'Good', ECONOMY: 'Workhorse',
}
const TIER_ORDER = ['PREMIUM', 'STANDARD', 'ECONOMY'] as const

// Reservations status → bar color. The token is the display token emitted by
// mapStatus() in /api/timeline-native (inquiry | hold | booked | cancelled) —
// NOT the raw Prisma BookingStatus. Keep these keys in lockstep with what
// mapStatus emits (dead keys read as bugs: bars fall back to `booked`).
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  inquiry:   { bg: 'bg-green-200', border: 'border-green-400', text: 'text-green-900' }, // quote sent / availability confirmed, no hold yet
  hold:      { bg: 'bg-blue-500',  border: 'border-blue-600',  text: 'text-white' },      // AI_REVIEW / PENDING_APPROVAL
  booked:    { bg: 'bg-green-600', border: 'border-green-700', text: 'text-white' },      // CONFIRMED / ACTIVE / RETURNED / ARCHIVED
  // Cancelled gets its OWN treatment so a cancelled bar never reads as booked:
  // muted grey + struck-through label. (Previously had no entry and fell back
  // to booked's color.) `line-through` rides in `text` because that class is
  // applied directly to the bar's label span — no per-bar JSX branch needed.
  cancelled: { bg: 'bg-gray-200',  border: 'border-gray-300',  text: 'text-gray-400 line-through' },
}

// Blind-pickup bar color — a BOOKED bar whose linked order is flagged
// blindPickup renders violet instead of booked-green (distinct from every
// status above). Applies to booked bars only; other statuses are unaffected.
const BLIND_PICKUP_COLOR = { bg: 'bg-violet-500', border: 'border-violet-600', text: 'text-white' } as const

// Unit N/A (out-of-service) — an open maintenance window on a unit's row.
// Grey now uniquely means "unavailable" (backups moved to faded blue below).
const UNIT_NA_COLOR = { bg: 'bg-gray-400', border: 'border-gray-500', text: 'text-white' } as const

// A booked bar becomes violet when its order is a blind pickup; everything
// else uses the plain status color (falling back to booked).
function barColor(status: string, blindPickup?: boolean) {
  if (status === 'booked' && blindPickup) return BLIND_PICKUP_COLOR
  return STATUS_COLORS[status] || STATUS_COLORS.booked
}

const CAT_LABELS: Record<string, string> = {
  cube: 'Cube', cargo: 'Cargo', pass: 'Pass Van', pop: 'PopVan',
  cam: 'Cam Cube', dlux: 'DLUX', scout: 'Scout', studio: 'Studio',
  stakebed: 'Stakebed', general: 'Other',
}

// Would a drop of the dragged bar onto this unit SUCCEED? Mirrors the assign
// endpoint's HARD blocks so the highlight can't disagree with the real result:
//   · different AssetCategory        → reject ("belongs to a different category")
//   · any booking overlapping window → reject (over-capacity / backup-has-dibs)
//   · N/A window overlapping         → treat as unavailable
// Buffer-adjacent (soft, override-able) is left as valid — it can still commit.
// Pure — hoisted to module scope so the memoized row component can share it.
function isValidDropTarget(unit: any, d: { fromAssetId: string; fromCat: string; winStart: string; winEnd: string }): boolean {
  if (!unit || unit.assetId === d.fromAssetId) return false
  if (unit.cat !== d.fromCat) return false
  const overlaps = (bk: any) => bk && bk.start <= d.winEnd && bk.end >= d.winStart
  if ((unit.bookings || []).some(overlaps)) return false
  if ((unit.naWindows || []).some((w: any) => w && w.start <= d.winEnd && (w.end || d.winEnd) >= d.winStart)) return false
  return true
}

// Pure bar-geometry: position bars in the RENDERED range, not the visible
// range — a bar in the pan buffer still renders so trackpad pan reveals it.
function computeBar(start: string, end: string, renderedStartDate: string, renderedDays: number, dayWidth: number) {
  const s = Math.max(0, diffDays(renderedStartDate, start))
  const e = Math.min(renderedDays - 1, diffDays(renderedStartDate, end))
  if (e < 0 || s >= renderedDays) return null
  return { left: s * dayWidth, width: Math.max((e - s + 1) * dayWidth - 2, dayWidth - 2) }
}

// Per-drag row highlight state (computed once per target change in the parent;
// the memoized row re-renders only when ITS state string flips).
type DropState = 'none' | 'source' | 'valid' | 'valid-hover' | 'invalid'
const DROP_STATE_CLASS: Record<DropState, string> = {
  none: '',
  source: '',
  valid: 'bg-green-50/60',
  'valid-hover': 'ring-2 ring-inset ring-green-500 bg-green-100/70',
  invalid: 'opacity-40',
}

// Optimistic drop: move a booking's bar(s) between unit rows in LOCAL state.
// Pure + inverse-safe — rollback is the same move with from/to swapped, so a
// failed drop can't clobber another concurrent drop's optimistic move (no
// snapshot restore). Bookings keep identity; target list re-sorts by start.
function moveBookingLocal(prev: any[], bookingItemId: string, fromAssetId: string, toAssetId: string): any[] {
  const source = prev.find((u) => u.assetId === fromAssetId)
  const moved = (source?.bookings ?? []).filter((bk: any) => bk && bk.bookingItemId === bookingItemId)
  if (moved.length === 0) return prev
  return prev.map((u) => {
    if (u.assetId === fromAssetId) {
      return { ...u, bookings: u.bookings.filter((bk: any) => !bk || bk.bookingItemId !== bookingItemId) }
    }
    if (u.assetId === toAssetId) {
      return {
        ...u,
        bookings: [...u.bookings, ...moved].sort((a: any, b: any) => String(a.start).localeCompare(String(b.start))),
      }
    }
    return u
  })
}

// Hit-test the unit row under a screen point (drag-to-reassign). The ghost
// + any overlay are pointer-events-none so elementFromPoint sees the row.
function unitAtPoint(x: number, y: number): { assetId: string; unit: string } | null {
  if (typeof document === 'undefined') return null
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-unit-assetid]') as HTMLElement | null
  if (!el) return null
  const assetId = el.getAttribute('data-unit-assetid')
  if (!assetId) return null
  return { assetId, unit: el.getAttribute('data-unit-name') || '' }
}

// Precomputed per-day-cell metadata (fix for per-render Date construction in
// every grid cell across all lanes).
interface DayMeta { ds: string; weekend: boolean; isToday: boolean; label: string }

// ── TimelineUnitRow — one asset's timeline lane(s): day grid + N/A windows +
//    primary bars (+ backup sub-lane). memo()'d so a drag-target change
//    re-renders ONLY the two rows whose dropState string flipped; all props
//    are stable (rowEntries identity is memoized, handlers are useCallback,
//    dayMeta/dimensions change only with the window). Behavior is identical
//    to the previous inline JSX — pure render-perf extraction. ──
interface TimelineUnitRowProps {
  entry: any
  dayMeta: DayMeta[]
  dayWidth: number
  renderedStartDate: string
  renderedDays: number
  lastRenderedDate: string
  canBindUnit: boolean
  canSetStatus: boolean
  dropState: DropState
  onRowClick: (unit: any, ev: React.MouseEvent<HTMLDivElement>) => void
  onBarPointerDown: (ev: React.PointerEvent<HTMLDivElement>, b: any, unit: any) => void
  onBarPointerMove: (ev: React.PointerEvent<HTMLDivElement>) => void
  onBarPointerUp: (ev: React.PointerEvent<HTMLDivElement>) => void
  onBarClick: (b: any, unit: any) => void
  onBackupClick: (b: any, unit: any, rank: number) => void
}

const TimelineUnitRow = memo(function TimelineUnitRow({
  entry,
  dayMeta,
  dayWidth,
  renderedStartDate,
  renderedDays,
  lastRenderedDate,
  canBindUnit,
  canSetStatus,
  dropState,
  onRowClick,
  onBarPointerDown,
  onBarPointerMove,
  onBarPointerUp,
  onBarClick,
  onBackupClick,
}: TimelineUnitRowProps) {
  const hasBackups = entry.backupBookings.length > 0
  const grid = (
    <div className="absolute inset-0 flex pointer-events-none">
      {dayMeta.map((d) => (
        <div
          key={d.ds}
          style={{ width: dayWidth, minWidth: dayWidth }}
          className={`flex-shrink-0 border-r border-gray-200 ${d.weekend ? 'bg-gray-200/60' : ''}`}
        />
      ))}
    </div>
  )
  return (
    <div>
      {/* Main row — primary bars only. Row-level onClick fires on empty-span
          clicks (bar onClicks stopPropagation); gated inside the handler. */}
      <div
        data-unit-assetid={entry.unit.assetId}
        data-unit-name={entry.unit.unitName}
        className={`relative h-8 border-b border-gray-100 ${canSetStatus ? 'cursor-pointer hover:bg-blue-50/20' : ''} ${DROP_STATE_CLASS[dropState]}`}
        onClick={(ev) => onRowClick(entry.unit, ev)}
      >
        {grid}
        {/* Unit N/A — open maintenance windows (grey, informational,
            click-through so the +Hold row gesture still works). Drawn
            before bookings so a real booking bar sits on top. */}
        {(entry.unit.naWindows || []).map((w: any, k: number) => {
          const bar = computeBar(w.start, w.end || lastRenderedDate, renderedStartDate, renderedDays, dayWidth)
          if (!bar) return null
          const referral = w.kind === 'referral'
          return (
            <div
              key={`na-${k}`}
              className={`absolute top-1 h-6 rounded-md ${UNIT_NA_COLOR.bg} border ${referral ? 'border-dashed border-amber-400' : UNIT_NA_COLOR.border} flex items-center px-1.5 overflow-hidden pointer-events-none opacity-90`}
              style={{ left: bar.left, width: bar.width }}
              title={`${w.title || 'Unit N/A'}${w.end ? ` (${w.start} – ${w.end})` : ` (from ${w.start})`}`}
            >
              <span className={`text-[9px] font-bold ${UNIT_NA_COLOR.text} truncate whitespace-nowrap`}>
                N/A · {referral ? 'pending review' : 'out of service'}
              </span>
            </div>
          )
        })}
        {/* Primary bars */}
        {entry.primaryBookings.map((b: any, j: number) => {
          const bar = computeBar(b.start, b.end, renderedStartDate, renderedDays, dayWidth)
          if (!bar) return null
          const sc = barColor(b.status, b.blindPickup)
          return (
            <div
              key={`p-${j}`}
              className={`absolute top-1 h-6 rounded-md ${sc.bg} border ${sc.border} flex items-center px-1.5 hover:opacity-90 transition-opacity overflow-hidden ${canBindUnit ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-pointer'}`}
              style={{ left: bar.left, width: bar.width }}
              onPointerDown={canBindUnit ? (ev) => onBarPointerDown(ev, b, entry.unit) : undefined}
              onPointerMove={canBindUnit ? onBarPointerMove : undefined}
              onPointerUp={canBindUnit ? onBarPointerUp : undefined}
              onClick={(ev) => {
                ev.stopPropagation()
                onBarClick(b, entry.unit)
              }}
            >
              <span className={`text-[9px] font-bold ${sc.text} truncate whitespace-nowrap`}>
                {b.clientName}{b.jobName ? ` · ${b.jobName}` : ''} · {fMonth(b.start)}–{fMonth(b.end)}
              </span>
            </div>
          )
        })}
      </div>
      {/* Backup sub-lane — faded-blue "queued hold" rank-2+ bars. Empty-span
          clicks delegate to the same asset-row handler. */}
      {hasBackups && (
        <div
          className={`relative h-8 border-b border-gray-100 bg-blue-50/60 ${canSetStatus ? 'cursor-pointer hover:bg-blue-100/60' : ''}`}
          onClick={(ev) => onRowClick(entry.unit, ev)}
        >
          {grid}
          {entry.backupBookings.map((b: any, j: number) => {
            const bar = computeBar(b.start, b.end, renderedStartDate, renderedDays, dayWidth)
            if (!bar) return null
            const rank = typeof b.holdRank === 'number' ? b.holdRank : 2
            const rankLabel = rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`
            return (
              <div
                key={`b-${j}`}
                className="absolute top-1 h-6 rounded-md bg-blue-200/70 border border-dashed border-blue-400 flex items-center px-1.5 cursor-pointer hover:bg-blue-200 transition-opacity overflow-hidden"
                style={{ left: bar.left, width: bar.width }}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onBackupClick(b, entry.unit, rank)
                }}
                title={`${rankLabel} hold — ${b.clientName}${b.jobName ? ` · ${b.jobName}` : ''}`}
              >
                <span className="text-[9px] font-semibold text-blue-800 truncate whitespace-nowrap">
                  {rankLabel} · {b.clientName}{b.jobName ? ` · ${b.jobName}` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

export default function GanttPage() {
  // 2026-07 re-split: unit assignment is SALES (canCreateBooking) — mirrors
  // the server gate on POST /booking-items/[id]/assign. Passed to NewHoldModal
  // so a user without assign rights makes a general hold instead of orphaning
  // on a 403. Drives the bar drag-reassign + "Assign / change units".
  const { data: session } = useSession()
  const sessionRole = (session?.user as { role?: UserRole } | undefined)?.role ?? null
  const canBindUnit = sessionRole ? getPermissions(sessionRole).canCreateBooking : false
  // FLEET capability (canAssignAssets) — N/A mark/clear, condition tier, asset
  // notes (AssetSummaryPanel edit). Split off canBindUnit in the re-split.
  const canFleetOps = sessionRole ? getPermissions(sessionRole).canAssignAssets : false
  // Task tow-vehicle/driver assignment — SALES or FLEET.
  const canAssignTasks = sessionRole
    ? getPermissions(sessionRole).canCreateBooking || getPermissions(sessionRole).canAssignAssets
    : false
  // Sales (canCreateBooking = AGENT + ADMIN) can set a reservation's status
  // from the bar. Intentionally wider than the ADMIN-only canConfirmBooking.
  const canSetStatus = sessionRole ? getPermissions(sessionRole).canCreateBooking : false
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id ?? null
  // Unit N/A (out-of-service) per-row action menu. Positioned fixed (the label
  // column scrolls, so an absolute dropdown would clip).
  const [unitMenu, setUnitMenu] = useState<null | { assetId: string; isNa: boolean; tier: string; x: number; y: number }>(null)
  // Asset summary panel — opened by clicking a unit's NAME (asset view).
  const [summaryAssetId, setSummaryAssetId] = useState<string | null>(null)
  const [naBusy, setNaBusy] = useState(false)
  const [naErr, setNaErr] = useState<string | null>(null)
  // Drag-to-reassign (FLEET only): drag an assigned primary bar onto another
  // unit row to rebind for the SAME dates via the existing assign/unassign
  // endpoints. Dates never change (that's the modal reschedule).
  const dragState = useRef<null | { bookingItemId: string; fromAssetId: string; fromUnit: string; fromCat: string; winStart: string; winEnd: string; label: string; startX: number; startY: number; moved: boolean; grabDX: number; grabDY: number; width: number; height: number; bg: string; border: string; text: string }>(null)
  const suppressBarClick = useRef(false)
  // PERF: `drag` state carries per-GESTURE constants + the current target only.
  // The ghost's x/y live OUTSIDE React (ghostPosRef + direct style.transform on
  // pointermove), so a frame where the hovered row didn't change renders
  // NOTHING — the old shape wrote a fresh {x,y,...} object per mousemove and
  // re-rendered the whole board 60-120×/s.
  const [drag, setDrag] = useState<null | { grabDX: number; grabDY: number; width: number; height: number; bg: string; border: string; text: string; label: string; fromAssetId: string; fromCat: string; winStart: string; winEnd: string; targetAssetId: string | null; targetUnit: string | null; targetValid: boolean }>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const ghostPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const [dragBusy, setDragBusy] = useState(false)
  const [dragErr, setDragErr] = useState<string | null>(null)
  const [dragBuffer, setDragBuffer] = useState<null | { bookingItemId: string; fromAssetId: string; toAssetId: string; toUnit: string; reason: string }>(null)

  // Bulletproof teardown for the unit drag-reassign ghost. Whatever ends the
  // gesture — a normal pointerup, pointercancel, Escape, window blur, or the
  // dragged bar unmounting mid-drag (e.g. a background timeline refresh) — the
  // ghost (driven by `drag`) is removed and the in-flight ref is cleared, so no
  // orphaned preview can be left mounted. The bar's own onPointerUp fires first
  // (React root handler runs before this window listener), so a valid drop
  // still completes its reassign before this net clears the visual.
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const clear = () => {
      dragState.current = null
      setDrag(null)
      // Swallow the click that trails a drag-end so it can't open the detail modal.
      suppressBarClick.current = true
      setTimeout(() => { suppressBarClick.current = false }, 0)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clear() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerup', clear)
    window.addEventListener('pointercancel', clear)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerup', clear)
      window.removeEventListener('pointercancel', clear)
      window.removeEventListener('blur', clear)
    }
  }, [dragging])
  const [assignTask, setAssignTask] = useState<any>(null)
  const [view, setView] = useState<'asset' | 'job'>('asset')
  const [weeks, setWeeks] = useState(2)
  const [catFilter, setCatFilter] = useState('all')
  const [jobs, setJobs] = useState<any[]>([])
  const [units, setUnits] = useState<any[]>([])
  const [unassignedHolds, setUnassignedHolds] = useState<any[]>([])
  const [assignBookingItemId, setAssignBookingItemId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<any>(null)
  const [actionPending, setActionPending] = useState<null | 'status' | 'release' | 'promote' | 'dates'>(null)
  // Reschedule (date-edit) local draft + buffer-encroachment warning, seeded
  // from the selected bar. Mirrors the status control's owner gating.
  const [dateDraft, setDateDraft] = useState<{ start: string; end: string }>({ start: '', end: '' })
  const [dateWarn, setDateWarn] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [holdModal, setHoldModal] = useState<null | {
    asset?: { id: string; unitName: string }
    categoryId: string
    categoryName: string
    startDate: string
    endDate: string
    asBackup: boolean
  }>(null)
  // Operator-controlled window anchor. Default mirrors the prior
  // behaviour (today-3) so the page renders the same on first load,
  // but ‹ Today › buttons step it forward/back by the current window
  // width and reset on demand.
  const defaultAnchor = useMemo(() => addDays(today, -3), [])
  const [anchorDate, setAnchorDate] = useState<string>(defaultAnchor)

  const totalDays = weeks * 7
  const dayWidth = weeks <= 2 ? 48 : weeks <= 3 ? 36 : 28
  // Top task lane: chip height + per-day stack slot pitch (chip + gap).
  const TASK_CHIP_H = 18
  const TASK_SLOT = 20
  const startDate = anchorDate
  // ── Render-vs-visible windows ────────────────────────────────────
  // The "visible window" is the [anchorDate, anchorDate + totalDays)
  // span the operator is currently looking at — what the header
  // range label, today line, and tier sort agree on. The "rendered
  // window" is wider: TWO full visible-windows worth of buffer on
  // each side, so trackpad / drag pan inside the scroll container
  // has actual DOM to scroll into (without this, the grid is the
  // exact width of the visible span and overflow-x has nothing to
  // do). Two windows (not one) so the default mid-grid scroll
  // position stays valid even on a wide monitor whose container is
  // wider than a single visible window — with only one buffer window
  // the default scrollLeft exceeded maxScroll on wide screens, clamped
  // to the edge, and tripped the recenter handler into a left↔right
  // oscillation. Near-edge scroll advances the anchor by `totalDays`
  // and compensates scrollLeft so the visual position stays put.
  const RENDER_BUFFER_WINDOWS = 2
  const renderedDays = totalDays * (1 + 2 * RENDER_BUFFER_WINDOWS)
  const renderedStartDate = useMemo(
    () => addDays(startDate, -totalDays * RENDER_BUFFER_WINDOWS),
    [startDate, totalDays],
  )
  const dates = useMemo(
    () => Array.from({ length: renderedDays }, (_, i) => addDays(renderedStartDate, i)),
    [renderedStartDate, renderedDays],
  )
  const todayOffset = diffDays(renderedStartDate, today)
  // PERF: per-day-cell metadata computed ONCE per window change. The grid
  // lanes previously ran `new Date(ds+'T12:00:00').getDay()` in EVERY cell of
  // EVERY lane on EVERY render (~3.6k Date allocations/frame while dragging).
  const dayMeta = useMemo<DayMeta[]>(
    () =>
      dates.map((ds) => ({
        ds,
        weekend: [0, 6].includes(new Date(ds + 'T12:00:00').getDay()),
        isToday: ds === today,
        label: fDay(ds),
      })),
    [dates, today],
  )

  // Fetch the timeline for the RENDERED range plus a ±7d cushion so
  // bars straddling the edge don't pop in/out as the operator pans.
  // Re-runs whenever the rendered range shifts; refreshTimeline()
  // below reads the same range so post-action refreshes stay in-window.
  const fetchRange = useMemo(() => {
    const from = addDays(renderedStartDate, -7)
    const to = addDays(renderedStartDate, renderedDays + 7)
    return { from, to }
  }, [renderedStartDate, renderedDays])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ from: fetchRange.from, to: fetchRange.to })
    fetch(`/api/timeline-native?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setJobs(d.jobs || [])
          setUnits(d.units || [])
          setUnassignedHolds(d.unassignedHolds || [])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fetchRange.from, fetchRange.to])

  // ── +Hold entry point: row click on an asset → modal pre-filled
  //    with that asset + clicked date. If the clicked date overlaps
  //    an existing booking on that unit, the modal opens in BACKUP
  //    mode (per "backup has dibs"); otherwise PRIMARY. Server still
  //    enforces availability — this is just UX. ──
  const openHoldOnAssetRow = useCallback((unit: any, e: React.MouseEvent<HTMLDivElement>) => {
    // Creating a hold is a sales action (canCreateBooking). Fleet/warehouse
    // (canAssignAssets-only) view + assign but create nothing — without this
    // gate an empty-row click opened the create-hold modal for fleet (the
    // endpoint now 403s them too, but don't offer the dead flow at all).
    if (!canSetStatus) return
    if (!unit?.assetId || !unit?.categoryId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    // The row's bounding rect spans the full rendered grid (one
    // buffer worth on each side of the visible window). dayIndex
    // is the column under the cursor in the rendered grid; clamp
    // to renderedDays so a stale right-edge click can't index out.
    const dayIndex = Math.max(0, Math.min(renderedDays - 1, Math.floor(x / dayWidth)))
    const clickedDate = dates[dayIndex]
    const overlap = Array.isArray(unit.bookings) && unit.bookings.some((b: any) => b && b.start <= clickedDate && b.end >= clickedDate)
    setHoldModal({
      asset: { id: unit.assetId, unitName: unit.unitName },
      categoryId: unit.categoryId,
      categoryName: unit.resourceName || unit.cat || 'Category',
      startDate: clickedDate,
      endDate: clickedDate,
      asBackup: !!overlap,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSetStatus, renderedDays, dayWidth, dates])

  // ── Refresh the timeline data after an action. Kept inline so the
  //    fetch URL stays consistent with the initial load. ──
  // SEQUENCE-GUARDED refetch: only the NEWEST response is applied, and no
  // snapshot is applied while a reassign is still in flight (a stale snapshot
  // would clobber a newer optimistic move and leave the board disagreeing
  // with the server — the root of the drag-back 404/409 bug). If a snapshot
  // is skipped because mutations are pending, the settle path refetches.
  const refetchSeq = useRef(0)
  const inFlightReassigns = useRef<Set<string>>(new Set())
  // Refetch requested by ANY drop — fires once the LAST in-flight settles
  // (shared across overlapping drops so no request is lost).
  const pendingRefetch = useRef(false)
  const refreshTimeline = useCallback(() => {
    const seq = ++refetchSeq.current
    setLoading(true)
    const params = new URLSearchParams({ from: fetchRange.from, to: fetchRange.to })
    fetch(`/api/timeline-native?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return
        if (seq !== refetchSeq.current) return // superseded by a newer refetch
        if (inFlightReassigns.current.size > 0) return // mutations pending — settle path will refetch
        setJobs(d.jobs || [])
        setUnits(d.units || [])
        setUnassignedHolds(d.unassignedHolds || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fetchRange.from, fetchRange.to])

  // ── Window paging. ‹ / › step by the current visible width
  //    (totalDays) so a 2W window pages two weeks at a time, a 4W
  //    window pages four. Today resets to the default anchor. ──
  function panBackward() { setAnchorDate(addDays(anchorDate, -totalDays)) }
  function panForward()  { setAnchorDate(addDays(anchorDate,  totalDays)) }
  function goToday()     { setAnchorDate(defaultAnchor) }

  // ── Scroll plumbing for trackpad / drag pan ─────────────────────
  // The rendered grid is 3× the visible span (see RENDER_BUFFER_WINDOWS
  // above). We position the scroll so the visible window's leftmost
  // day sits at the start of the body — one buffer worth of past
  // columns is immediately accessible by scrolling left, one buffer
  // worth of future by scrolling right. When the operator scrolls
  // past either edge, advance the anchor by `totalDays` and write
  // the compensating scrollLeft via `pendingScrollLeft.current` so
  // the visual position is preserved across the re-render.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  // Set by edge-advance scroll handlers; read by the position effect
  // below to override the default "snap to visible window" behavior
  // on re-renders driven by scroll (not by the </>/Today buttons or
  // a window-size change).
  const pendingScrollLeft = useRef<number | null>(null)
  // Records the (clamped) scrollLeft we set programmatically so the
  // `onScroll` event that write triggers can be recognized and ignored
  // by handleScroll. Without this, a programmatic write that lands in an
  // edge zone (e.g. clamped on a wide monitor) re-triggers the recenter,
  // which writes scrollLeft again → onScroll → … → the wild left↔right
  // pan operators reported.
  const lastProgrammaticScrollLeft = useRef<number | null>(null)

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const target = pendingScrollLeft.current !== null
      ? pendingScrollLeft.current
      // Default: position the visible window at the left of the body.
      // RENDER_BUFFER_WINDOWS worth of past columns sit to the left in
      // the scroll buffer, accessible by scrolling backwards.
      : totalDays * RENDER_BUFFER_WINDOWS * dayWidth
    pendingScrollLeft.current = null
    el.scrollLeft = target
    // Read back the value the browser actually applied (it clamps to
    // [0, maxScroll]); that's what the echoing onScroll will report.
    lastProgrammaticScrollLeft.current = el.scrollLeft
  }, [anchorDate, weeks, totalDays, dayWidth])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    // Ignore scroll events caused by our own programmatic scrollLeft
    // writes — only react to genuine user pans. Keep ignoring while the
    // position equals what we set (a single write can echo more than
    // once); clear once the user actually moves away from it.
    if (lastProgrammaticScrollLeft.current !== null) {
      if (Math.abs(el.scrollLeft - lastProgrammaticScrollLeft.current) <= 1) return
      lastProgrammaticScrollLeft.current = null
    }
    const maxScroll = el.scrollWidth - el.clientWidth
    if (maxScroll <= 0) return
    // 3-column-wide trigger zone at each edge — wide enough to
    // catch fast trackpad swipes, narrow enough that a normal
    // mid-grid scroll never trips it.
    const edge = dayWidth * 3
    if (el.scrollLeft < edge) {
      pendingScrollLeft.current = el.scrollLeft + totalDays * dayWidth
      setAnchorDate(addDays(anchorDate, -totalDays))
    } else if (el.scrollLeft > maxScroll - edge) {
      pendingScrollLeft.current = el.scrollLeft - totalDays * dayWidth
      setAnchorDate(addDays(anchorDate, totalDays))
    }
  }

  // Range label for the header — "Jun 2 – Jun 29" style, both ends inclusive.
  const visibleEndDate = addDays(startDate, totalDays - 1)
  const rangeLabel = `${fMonth(startDate)} – ${fMonth(visibleEndDate)}`

  function closeModal() {
    setSelected(null)
    setActionPending(null)
    setActionError(null)
    setActionSuccess(null)
  }

  // ── PART 4 actions. Book/Release on a bar click.
  //    ALL of these are SALES actions (canCreateBooking) — promote/release
  //    moved off canAssignAssets per Wes; fleet keeps only assignment.
  //    PRIMARY (holdRank=1):
  //      Status  → POST /api/scheduling/bookings/[bookingId]/status
  //                  (sales set Inquiry/Hold/Booked/Cancelled; canCreateBooking,
  //                   own bookings only — replaces the old dispatch-gated Book)
  //      Release → POST /api/scheduling/booking-items/[id]/release
  //    BACKUP (holdRank ≥ 2):
  //      Book    → POST /api/scheduling/booking-items/[id]/promote
  //                   THEN POST .../bookings/[bookingId]/confirm
  //      Release → POST /api/scheduling/booking-items/[id]/release
  //
  //    PRIMARY actions on a primary bar; PROMOTE + Release on a
  //    backup bar. Promote is its OWN action — it flips the
  //    rank-2 to rank-1 but does NOT auto-confirm; the bar then
  //    re-renders as a primary and the operator clicks Book if
  //    they want to confirm.
  //
  //    Popup STAYS OPEN after each action; banners show the new
  //    state. Release is the one exception — the row goes away
  //    so we close the popup. ──
  // Sales status set (Inquiry/Hold/Booked/Cancelled). Booked (CONFIRMED)
  // requires no rental agreement — the endpoint is a side-effect-free flip.
  const STATUS_TO_RAW = { inquiry: 'REQUEST', hold: 'PENDING_APPROVAL', booked: 'CONFIRMED', cancelled: 'CANCELLED' } as const
  async function handleSetStatus(next: 'inquiry' | 'hold' | 'booked' | 'cancelled') {
    if (!selected) return
    const bookingId: string | undefined = selected.bookingId
    if (!bookingId) {
      setActionError('Missing bookingId on the selected bar — refresh and retry.')
      return
    }
    if (selected.status === next) return
    setActionPending('status')
    setActionError(null)
    setActionSuccess(null)
    try {
      const res = await fetch(`/api/scheduling/bookings/${bookingId}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.reason || json.error || `status change failed (${res.status})`)
      }
      setActionSuccess(`Status set to ${next}.`)
      // Reflect the new state in the open popup so it recolors without a re-click.
      setSelected((prev: any) => prev ? { ...prev, status: next, bookingStatus: STATUS_TO_RAW[next] } : prev)
      refreshTimeline()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionPending(null)
    }
  }

  // Seed the date draft (and clear any buffer warning) whenever the selected
  // bar changes — including after an optimistic patch that moves the bar.
  useEffect(() => {
    if (selected) setDateDraft({ start: selected.start ?? '', end: selected.end ?? '' })
    setDateWarn(null)
  }, [selected])

  // Reschedule the booking window. bufferOverride=true resubmits past a
  // buffer-encroachment warning (over-capacity / hard overlap has no override).
  async function handleSetDates(bufferOverride = false) {
    if (!selected) return
    const bookingId: string | undefined = selected.bookingId
    if (!bookingId) {
      setActionError('Missing bookingId on the selected bar — refresh and retry.')
      return
    }
    const { start, end } = dateDraft
    if (!start || !end || end < start) {
      setActionError('End date must be on or after start date.')
      return
    }
    if (start === selected.start && end === selected.end) return
    setActionPending('dates')
    setActionError(null)
    setActionSuccess(null)
    if (!bufferOverride) setDateWarn(null)
    try {
      const res = await fetch(`/api/scheduling/bookings/${bookingId}/dates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startDate: start, endDate: end, bufferDays: 1, bufferOverride }),
      })
      const json = await res.json()
      if (res.status === 409 && json.error === 'buffer-encroachment' && json.needsOverride) {
        setDateWarn(json.reason || 'Rescheduling would encroach on a buffer window.')
        return
      }
      if (!res.ok || !json.ok) {
        throw new Error(json.reason || json.error || `reschedule failed (${res.status})`)
      }
      setActionSuccess('Dates updated.')
      setDateWarn(null)
      // Optimistically move the bar in the open popup; refreshTimeline re-fetches
      // so the rendered bar repositions/resizes.
      setSelected((prev: any) => prev ? { ...prev, start, end } : prev)
      refreshTimeline()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionPending(null)
    }
  }

  async function handlePromote() {
    if (!selected) return
    const bookingItemId: string | undefined = selected.bookingItemId ?? selected.reservationId
    if (!bookingItemId) {
      setActionError('Missing bookingItemId on the selected bar — refresh and retry.')
      return
    }
    setActionPending('promote')
    setActionError(null)
    setActionSuccess(null)
    try {
      const res = await fetch(`/api/scheduling/booking-items/${bookingItemId}/promote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.reason || json.error || `promote failed (${res.status})`)
      }
      setActionSuccess(json.alreadyPromoted ? 'Already primary.' : 'Promoted to primary.')
      // Reflect the new state: this bar is now a rank-1 primary.
      // The popup re-renders with Book + Release (no more Promote).
      setSelected((prev: any) => prev ? { ...prev, holdRank: 1, isBackup: false } : prev)
      refreshTimeline()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionPending(null)
    }
  }

  async function handleRelease() {
    if (!selected) return
    const bookingItemId: string | undefined = selected.bookingItemId ?? selected.reservationId
    if (!bookingItemId) {
      setActionError('Missing bookingItemId on the selected bar — refresh and retry.')
      return
    }
    setActionPending('release')
    setActionError(null)
    setActionSuccess(null)
    try {
      const res = await fetch(`/api/scheduling/booking-items/${bookingItemId}/release`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.reason || json.error || `release failed (${res.status})`)
      }
      // Release removes the bar from the timeline — close the popup
      // since there's nothing left to show.
      refreshTimeline()
      closeModal()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
      setActionPending(null)
    }
  }

  // Sales "Refer to Maintenance" (canCreateBooking) / fleet "Mark Not Available"
  // + "Clear" (canAssignAssets) — open/close OPEN MaintenanceRecords, flowing
  // through the shipped N/A grey display. Server enforces the per-action perm.
  async function handleUnitNa(assetId: string, action: 'refer' | 'mark-na' | 'clear') {
    setNaBusy(true)
    setNaErr(null)
    try {
      const res = await fetch(`/api/scheduling/assets/${assetId}/maintenance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.reason || json.error || `failed (${res.status})`)
      setUnitMenu(null)
      refreshTimeline()
    } catch (e) {
      setNaErr(e instanceof Error ? e.message : String(e))
    } finally {
      setNaBusy(false)
    }
  }

  // (Condition tier is set from the AssetSummaryPanel — the canonical setter —
  // via PATCH /assets/[id]/summary; the older POST /assets/[id]/tier endpoint
  // remains live for API parity but has no UI caller here anymore.)

  // Reassign a booking item to a different unit for the SAME dates via the exact
  // endpoints AssignUnitsModal uses (unassign old → assign new). The assign route
  // hard-blocks a fully-assigned item, so the old pick MUST be released first.
  // If binding the new unit then fails, we RESTORE the old assignment on the
  // server. Dates never change here.
  //
  // OPTIMISTIC DROP: the bar moves in LOCAL state the moment it's dropped; the
  // two mutations run in the background. Every failure path rolls the local
  // move back via the INVERSE move (never a snapshot restore, so a concurrent
  // drop's optimistic state can't be clobbered) AND surfaces a readable error —
  // the board is never silently wrong. refreshTimeline() stays the eventual
  // truth-reconciler after the mutations settle. A combined single-call
  // reassign endpoint was considered and rejected: it would fork the assign
  // route's rank/capacity/buffer validation (not a small, safe addition).
  const doReassign = useCallback(async (bookingItemId: string, fromAssetId: string, toAssetId: string, toUnit: string, bufferOverride = false) => {
    const assignUnit = async (assetId: string, override: boolean) => {
      const r = await fetch(`/api/scheduling/booking-items/${bookingItemId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, bufferDays: 1, bufferOverride: override }),
      })
      return { status: r.status, ok: r.ok, j: await r.json().catch(() => ({} as any)) }
    }
    const unassignUnit = async (assetId: string) => {
      const r = await fetch(`/api/scheduling/booking-items/${bookingItemId}/unassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId }),
      })
      return { ok: r.ok, j: await r.json().catch(() => ({} as any)) }
    }

    // Optimistic: the bar lands on the target row NOW.
    setUnits((prev) => moveBookingLocal(prev, bookingItemId, fromAssetId, toAssetId))
    const rollback = () => setUnits((prev) => moveBookingLocal(prev, bookingItemId, toAssetId, fromAssetId))

    // Register the in-flight reassign: a new drag on THIS booking is blocked
    // until these mutations settle (other bookings stay draggable), and the
    // reconciling refetch is DEFERRED to settle-time so a mid-flight snapshot
    // can never clobber the optimistic state. This is the drag-back 404/409
    // fix — the second drag used the optimistic row while the server was
    // still mid-move.
    inFlightReassigns.current.add(bookingItemId)

    setDragBusy(true)
    setDragErr(null)
    try {
      // 1. Release the old unit. If this fails (e.g. checked out), the server
      //    never changed — undo the local move.
      const u = await unassignUnit(fromAssetId)
      if (!u.ok || !u.j.ok) {
        rollback()
        setDragErr(u.j.reason || u.j.error || 'Could not release the current unit — move undone.')
        return
      }
      // 2. Bind the new unit. Success → the optimistic state already matches
      //    the server; the settle path refetches to reconcile derived fields.
      const a = await assignUnit(toAssetId, bufferOverride)
      if (a.ok && a.j.ok) {
        setDragBuffer(null)
        pendingRefetch.current = true
        return
      }
      // 3. New unit rejected — restore the old assignment on the server, and
      //    undo the local move either way.
      rollback()
      const restore = await assignUnit(fromAssetId, true)
      if (!restore.ok || !restore.j.ok) {
        setDragErr(`Move failed and the old unit couldn't be restored (${restore.j.reason || restore.j.error || 'unknown'}). Reassign via “change units”.`)
        pendingRefetch.current = true // board truth diverged (item unassigned) — reconcile at settle
        return
      }
      // Old is back exactly where it was, on server and screen.
      if (a.status === 409 && a.j.error === 'buffer-encroachment' && a.j.needsOverride) {
        // Confirming the override re-runs doReassign(..., true), which
        // re-applies the optimistic move.
        setDragBuffer({ bookingItemId, fromAssetId, toAssetId, toUnit, reason: a.j.reason || 'This move encroaches a turnaround buffer.' })
        return
      }
      setDragErr(a.j.reason || a.j.error || `Reassign failed (${a.status}) — move undone.`)
    } catch (e) {
      // Network failure mid-sequence — server state unknown. Roll the local
      // move back, say so, and reconcile at settle.
      rollback()
      setDragErr(`${e instanceof Error ? e.message : String(e)} — move undone.`)
      pendingRefetch.current = true
    } finally {
      // Settle: unblock this booking; refetch once the LAST in-flight
      // reassign completes so the snapshot reflects all mutations.
      inFlightReassigns.current.delete(bookingItemId)
      if (pendingRefetch.current && inFlightReassigns.current.size === 0) {
        pendingRefetch.current = false
        refreshTimeline()
      }
      setDragBusy(false)
    }
  }, [refreshTimeline])

  // Wrapper over the pure module-level computeBar (kept for the non-row call
  // sites: task band chips, job view, needs-assign lane).
  function getBar(start: string, end: string) {
    return computeBar(start, end, renderedStartDate, renderedDays, dayWidth)
  }

  const allCats = [...new Set(units.map(u => u.cat))].sort()
  const filteredUnits = catFilter === 'all' ? units : units.filter(u => u.cat === catFilter)

  // Drop-target validity for the WHOLE board, computed ONCE per drag gesture
  // (not per row per frame). Rows derive a DropState string from this map —
  // the memoized row re-renders only when its own state flips.
  const dragGestureKey = drag ? `${drag.fromAssetId}|${drag.fromCat}|${drag.winStart}|${drag.winEnd}` : null
  const dropValidity = useMemo(() => {
    if (!drag) return null
    const m = new Map<string, boolean>()
    for (const u of filteredUnits) m.set(u.assetId, isValidDropTarget(u, drag))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragGestureKey, filteredUnits])

  function dropStateFor(assetId: string): DropState {
    if (!drag || !dropValidity) return 'none'
    if (assetId === drag.fromAssetId) return 'source'
    if (!dropValidity.get(assetId)) return 'invalid'
    return drag.targetAssetId === assetId ? 'valid-hover' : 'valid'
  }

  // ── Stable handlers for the memoized TimelineUnitRow (fix 4). All close
  //    over refs/setters (stable) so non-target rows skip re-render. ──
  const onBarPointerDown = useCallback((ev: React.PointerEvent<HTMLDivElement>, b: any, unit: any) => {
    ev.stopPropagation()
    // This booking's previous reassign hasn't settled — its on-screen row may
    // not match the server yet, so a drag now would act on a stale position
    // (the drag-back 404/409 bug). Ignore the gesture; the settle refetch
    // unblocks it moments later. Other bookings drag freely.
    if (inFlightReassigns.current.has(b.bookingItemId)) return
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
    const sc = barColor(b.status, b.blindPickup)
    dragState.current = {
      bookingItemId: b.bookingItemId,
      fromAssetId: unit.assetId,
      fromUnit: unit.unitName,
      // Source unit's category IS the booking's category (assign enforces
      // asset.categoryId === bookingItem.categoryId); its dates are the drop
      // window — both pre-mark valid target rows.
      fromCat: unit.cat,
      winStart: b.start,
      winEnd: b.end,
      label: `${b.clientName}${b.jobName ? ` · ${b.jobName}` : ''}`,
      startX: ev.clientX,
      startY: ev.clientY,
      moved: false,
      // Where inside the bar the grab happened, so the ghost tracks the
      // cursor from that point. Viewport coords → the fixed ghost +
      // elementFromPoint hit-test both account for board scroll automatically.
      grabDX: ev.clientX - rect.left,
      grabDY: ev.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      bg: sc.bg,
      border: sc.border,
      text: sc.text,
    }
  }, [])

  const onBarPointerMove = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    const d = dragState.current
    if (!d) return
    if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 5) return
    d.moved = true
    // Per-frame: move the ghost DIRECTLY (no React render).
    ghostPosRef.current = { x: ev.clientX, y: ev.clientY }
    if (ghostRef.current) {
      ghostRef.current.style.transform = `translate(${ev.clientX - d.grabDX}px, ${ev.clientY - d.grabDY}px)`
    }
    const tgt = unitAtPoint(ev.clientX, ev.clientY)
    const tgtId = tgt?.assetId ?? null
    // State updates ONLY when the hovered target row changes (or the first
    // moved frame) — returning prev makes React skip the render entirely.
    setDrag((prev) => {
      if (prev && prev.targetAssetId === tgtId) return prev
      const tgtUnit = tgt ? filteredUnits.find((u: any) => u.assetId === tgt.assetId) : null
      const targetValid = tgt ? isValidDropTarget(tgtUnit, d) : false
      return { grabDX: d.grabDX, grabDY: d.grabDY, width: d.width, height: d.height, bg: d.bg, border: d.border, text: d.text, label: d.label, fromAssetId: d.fromAssetId, fromCat: d.fromCat, winStart: d.winStart, winEnd: d.winEnd, targetAssetId: tgtId, targetUnit: tgt?.unit ?? null, targetValid }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredUnits])

  const onBarPointerUp = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    const d = dragState.current
    dragState.current = null
    ;(ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId)
    setDrag(null)
    if (!d || !d.moved) return // no drag → let onClick open the detail modal
    suppressBarClick.current = true // this was a drag; swallow the trailing click
    setTimeout(() => { suppressBarClick.current = false }, 0)
    const tgt = unitAtPoint(ev.clientX, ev.clientY)
    if (tgt && tgt.assetId && tgt.assetId !== d.fromAssetId) {
      void doReassign(d.bookingItemId, d.fromAssetId, tgt.assetId, tgt.unit)
    }
  }, [doReassign])

  const onBarClick = useCallback((b: any, unit: any) => {
    if (suppressBarClick.current) { suppressBarClick.current = false; return }
    setSelected({ ...b, unitName: unit.unitName, isUnit: true, holdRank: 1 })
  }, [])

  const onBackupClick = useCallback((b: any, unit: any, rank: number) => {
    setSelected({ ...b, unitName: unit.unitName, isUnit: true, holdRank: rank, isBackup: true })
  }, [])

  // ── Booked-in-window sort + divider rows ──
  // Two-tier: any asset with a booking overlapping the CURRENTLY
  // VISIBLE window floats above idle assets. Within each tier the
  // API's category+unitName ordering is preserved (stable sort).
  // Recomputes only on filteredUnits / window changes — not every
  // horizontal-scroll frame.
  // ── Each unit's bookings split into primary (holdRank=1 OR
  //    legacy missing holdRank) vs backup (holdRank>=2). Backup
  //    bookings render as a greyed sub-lane beneath the asset
  //    row. ORPHANED backups (unit holding only a rank-2 after
  //    a primary release-without-promote) still render — otherwise
  //    the agent hits the backup-has-dibs 409 on a unit that looks
  //    empty and can't tell why. ──
  // RowEntry now carries a third type for category-level REQUESTED
  // holds with zero assignments. Without it those holds drop out of
  // By-Asset entirely (units[] is keyed by Asset, so no-asset → no row).
  type RowEntry =
    | { type: 'unit'; unit: any; primaryBookings: any[]; backupBookings: any[] }
    | { type: 'divider'; label: string; accent?: 'warn' | 'idle' }
    | { type: 'taskBand'; tasks: any[]; bandHeight: number }
  const { rowEntries } = useMemo(() => {
    const visibleStart = startDate
    const visibleEnd = addDays(startDate, totalDays - 1)
    const splitBookings = (u: any): { primary: any[]; backup: any[] } => {
      const bs: any[] = Array.isArray(u.bookings) ? u.bookings : []
      const primary: any[] = []
      const backup: any[] = []
      for (const b of bs) {
        if (!b) continue
        const rank = typeof b.holdRank === 'number' ? b.holdRank : 1
        if (rank >= 2) backup.push(b)
        else primary.push(b)
      }
      return { primary, backup }
    }
    const isBookedInWindow = (u: any) =>
      Array.isArray(u.bookings) && u.bookings.some((b: any) => b && b.start <= visibleEnd && b.end >= visibleStart)
    // Canonical unit order — MUST match the server sort (timeline-native):
    // category order, then numeric unitName. Applied as the tiebreaker AFTER the
    // booked/idle class, so BOTH sections are strictly numerical per class and
    // the order is deterministic regardless of how units arrive (rather than a
    // stable split that merely trusted the incoming order). A reassign settles
    // the moved vehicle into its sorted spot — no positional row swap.
    const catOrder = ['cube', 'cargo', 'pass', 'pop', 'cam', 'dlux', 'scout', 'studio', 'stakebed', 'general']
    const canonicalCmp = (a: any, b: any) => {
      const ca = catOrder.indexOf(a.cat)
      const cb = catOrder.indexOf(b.cat)
      if (ca !== cb) return ca - cb
      return String(a.unitName).localeCompare(String(b.unitName), undefined, { numeric: true })
    }
    const sorted = [...filteredUnits].sort((a, b) => {
      const av = isBookedInWindow(a) ? 0 : 1
      const bv = isBookedInWindow(b) ? 0 : 1
      if (av !== bv) return av - bv
      return canonicalCmp(a, b)
    })
    let booked = 0
    for (const u of sorted) if (isBookedInWindow(u)) booked++
    const idle = sorted.length - booked
    const entries: RowEntry[] = []

    // Top lane: unassigned holds. Filter to ones overlapping the
    // visible window AND respecting the current catFilter (the user's
    // category filter applies symmetrically to "needs assignment" so
    // we don't leak Cargo holds into a Cube-filtered view).
    const visibleUnassigned = unassignedHolds.filter((h) => {
      const inWindow = h.start <= visibleEnd && h.end >= visibleStart
      const matchesCatFilter = catFilter === 'all' || h.cat === catFilter
      return inWindow && matchesCatFilter
    })
    if (visibleUnassigned.length > 0) {
      // One compact band at the top of the chart: tasks sit on their scheduled
      // day, and multiple tasks on the SAME day stack vertically in that day's
      // column. A stronger bottom border delineates the band from the vehicles.
      const dayCounts = new Map<string, number>()
      const stacked = visibleUnassigned
        .slice()
        .sort((a, b) =>
          String(a.start).localeCompare(String(b.start)) ||
          String(a.scheduledTime).localeCompare(String(b.scheduledTime)) ||
          String(a.clientName).localeCompare(String(b.clientName)),
        )
        .map((t) => {
          const stackIndex = dayCounts.get(t.start) ?? 0
          dayCounts.set(t.start, stackIndex + 1)
          return { ...t, stackIndex }
        })
      const maxStack = Math.max(1, ...Array.from(dayCounts.values()))
      entries.push({ type: 'taskBand', tasks: stacked, bandHeight: maxStack * TASK_SLOT + 6 })
    }

    for (let i = 0; i < sorted.length; i++) {
      if (i === booked && booked > 0 && idle > 0) {
        entries.push({ type: 'divider', label: `${idle} idle in this window`, accent: 'idle' })
      }
      const split = splitBookings(sorted[i])
      entries.push({ type: 'unit', unit: sorted[i], primaryBookings: split.primary, backupBookings: split.backup })
    }
    return { rowEntries: entries, bookedCount: booked, idleCount: idle }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredUnits, unassignedHolds, catFilter, weeks, startDate, totalDays])

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-bold text-gray-900">{SCHEDULE_LABEL}</h1>
          <ScheduleViewToggle current="gantt" />
          {loading && <span className="text-[11px] text-gray-400">Loading...</span>}
          {!loading && <span className="text-[11px] text-gray-400">{units.length} units · {jobs.length} jobs · Live</span>}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setView('asset')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'asset' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By Asset</button>
            <button onClick={() => setView('job')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'job' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By Job</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Window pager — steps by the current visible width. Today
              resets to the default anchor (today − 3d). */}
          <div className="flex items-center gap-1">
            <button
              onClick={panBackward}
              className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-[13px] hover:bg-gray-200"
              aria-label="Previous window"
              title={`Back ${totalDays} days`}
            >‹</button>
            <button
              onClick={goToday}
              className="px-2 h-7 rounded-lg bg-gray-100 text-[11px] font-semibold text-gray-600 hover:bg-gray-200"
            >Today</button>
            <button
              onClick={panForward}
              className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-[13px] hover:bg-gray-200"
              aria-label="Next window"
              title={`Forward ${totalDays} days`}
            >›</button>
          </div>
          <span className="text-[11px] font-semibold text-gray-500 px-1">{rangeLabel}</span>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[1,2,3,4].map(w => (
              <button key={w} onClick={() => setWeeks(w)} className={`px-2 py-1 rounded-md text-[10px] font-semibold ${weeks === w ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{w}W</button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend — must exactly match the tokens mapStatus emits + STATUS_COLORS. */}
      <div className="flex gap-3 mb-2 text-[10px] flex-wrap">
        {[
          { label: 'Inquiry', color: 'bg-green-200', struck: false },
          { label: 'Hold', color: 'bg-blue-500', struck: false },
          { label: 'Booked', color: 'bg-green-600', struck: false },
          { label: 'Booked · Blind Pickup', color: 'bg-violet-500', struck: false },
          { label: 'Cancelled', color: 'bg-gray-200', struck: true },
          { label: 'Unit N/A (in service)', color: 'bg-gray-400', struck: false },
          { label: 'Backup (queued)', color: 'bg-blue-200', struck: false },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className={`w-3 h-2 rounded-sm border border-black/5 ${l.color}`} />
            <span className={`text-gray-500 ${l.struck ? 'line-through' : ''}`}>{l.label}</span>
          </div>
        ))}
        {/* Condition-tier key — the left-of-name dot color (Asset.tier). */}
        <span className="text-gray-300">|</span>
        <span className="text-gray-400 font-medium">Condition:</span>
        {TIER_ORDER.map(t => (
          <div key={t} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full border border-black/5" style={{ background: TIER_COLORS[t] }} />
            <span className="text-gray-500">{TIER_LABELS[t]}</span>
          </div>
        ))}
      </div>

      {/* Gantt — single scroll container.
          - outer `overflow-auto` owns both vertical AND horizontal scroll
          - labels column is `sticky left-0` (pins horizontally while dates scroll)
          - date header row is `sticky top-0` (pins vertically while rows scroll)
          - top-left corner cell is sticky on BOTH axes
          Row heights match exactly between the two columns: h-8 unit rows,
          h-6 divider rows, h-10 header — all with box-sizing border-box
          (Tailwind default) so 1px borders are counted in the height. */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="border border-gray-200 rounded-lg overflow-auto bg-white relative"
        style={{ height: 'calc(100vh - 210px)' }}
      >
        <div className="flex" style={{ width: 192 + renderedDays * dayWidth, minWidth: '100%' }}>
          {/* ── LEFT: labels column (sticky left:0) ── */}
          <div className="w-48 flex-shrink-0 sticky left-0 z-20 bg-gray-50 border-r border-gray-200">
            {/* Top-left corner — sticky on both axes. In Asset view it hosts the
                category filter (sits directly above the unit list it filters);
                Job view keeps the plain "Client" column header. */}
            <div className="h-10 border-b border-gray-200 px-2 flex items-center bg-gray-50 sticky top-0 z-30">
              {view === 'asset' ? (
                <select
                  value={catFilter}
                  onChange={e => setCatFilter(e.target.value)}
                  aria-label="Filter units by category"
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white text-gray-700"
                >
                  <option value="all">All Categories</option>
                  {allCats.map(c => <option key={c} value={c}>{CAT_LABELS[c] || c}</option>)}
                </select>
              ) : (
                <span className="text-[10px] font-bold text-gray-400 uppercase">Client</span>
              )}
            </div>

            {view === 'asset' ? (
              rowEntries.map((entry, i) => {
                if (entry.type === 'divider') {
                  const accentClass =
                    entry.accent === 'warn' ? 'bg-rose-50' : 'bg-gray-100'
                  const textClass =
                    entry.accent === 'warn' ? 'text-rose-700' : 'text-gray-500'
                  return (
                    <div
                      key={`d-${i}`}
                      className={`h-6 border-b border-gray-200 px-3 flex items-center ${accentClass}`}
                    >
                      <span className={`text-[9px] uppercase tracking-wide font-semibold ${textClass}`}>
                        {entry.label}
                      </span>
                    </div>
                  )
                }
                if (entry.type === 'taskBand') {
                  return (
                    <div
                      key={`tb-${i}`}
                      style={{ height: entry.bandHeight }}
                      className="border-b-2 border-gray-300 px-3 flex flex-col justify-center bg-rose-50/40"
                    >
                      <div className="text-[10px] font-bold text-rose-700 uppercase tracking-wide leading-tight">Tasks</div>
                      <div className="text-[9px] text-rose-600 italic leading-tight">
                        {entry.tasks.length} need{entry.tasks.length === 1 ? 's' : ''} assignment
                      </div>
                    </div>
                  )
                }
                const hasBackups = entry.backupBookings.length > 0
                return (
                  <div key={`u-${entry.unit.assetId}`}>
                    <div className="h-8 border-b border-gray-100 px-3 flex items-center gap-2 bg-gray-50">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: TIER_COLORS[entry.unit.tier] || '#9ca3af' }}
                        title={`Condition: ${TIER_LABELS[entry.unit.tier] || 'unset'}`}
                      />
                      {/* Name click → asset summary panel (separate from the "…" menu). */}
                      <div
                        className="min-w-0 cursor-pointer group"
                        onClick={(e) => { e.stopPropagation(); setSummaryAssetId(entry.unit.assetId) }}
                        title="Vehicle summary"
                      >
                        <div className="text-[11px] font-semibold text-gray-900 truncate group-hover:underline">{entry.unit.unitName}</div>
                        <div className="text-[9px] text-gray-400 truncate">{entry.unit.resourceName}</div>
                      </div>
                      {(() => {
                        const na = (entry.unit.naWindows || []) as any[]
                        const isNa = na.length > 0
                        const referralPending = na.some((w) => w.kind === 'referral')
                        // A kebab appears only when the viewer has an available action:
                        // sales can refer a non-N/A unit; fleet can mark/clear.
                        const canAny = (canSetStatus && !isNa) || canFleetOps
                        return (
                          <div className="ml-auto flex items-center gap-1">
                            {isNa && (
                              <span className={`text-[8px] font-bold px-1 rounded ${referralPending ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600'}`}>
                                {referralPending ? 'N/A?' : 'N/A'}
                              </span>
                            )}
                            {canAny && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                  setNaErr(null)
                                  setUnitMenu(
                                    unitMenu?.assetId === entry.unit.assetId
                                      ? null
                                      : { assetId: entry.unit.assetId, isNa, tier: entry.unit.tier, x: r.right, y: r.bottom },
                                  )
                                }}
                                className="text-gray-400 hover:text-gray-700 text-[13px] leading-none px-1"
                                title="Unit availability"
                              >⋯</button>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                    {hasBackups && (
                      <div className="h-8 border-b border-gray-100 px-3 flex items-center gap-2 bg-gray-100/70">
                        <span className="text-[9px] text-gray-400">└</span>
                        <div className="text-[10px] text-gray-500 italic truncate">
                          {entry.backupBookings.length === 1 ? '2nd hold queue' : `${entry.backupBookings.length} backups queued`}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            ) : (
              jobs.map((job, i) => (
                <div
                  key={i}
                  className="h-8 border-b border-gray-100 px-3 flex items-center cursor-pointer hover:bg-gray-100 bg-gray-50"
                  onClick={() => setSelected(job)}
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-gray-900 truncate">{job.company}</div>
                    <div className="text-[9px] text-gray-400 truncate">{job.items?.length} unit{job.items?.length !== 1 ? 's' : ''} · {fMonth(job.startDate)}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── RIGHT: timeline column ── */}
          <div className="flex-shrink-0" style={{ width: renderedDays * dayWidth }}>
            {/* Sticky date header */}
            <div className="flex h-10 border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
              {dayMeta.map(d => (
                <div
                  key={d.ds}
                  style={{ width: dayWidth, minWidth: dayWidth }}
                  className={`flex-shrink-0 flex items-center justify-center text-[10px] border-r border-gray-200 ${d.isToday ? 'bg-blue-50 font-bold text-blue-600' : d.weekend ? 'bg-gray-200/60 text-gray-500' : 'text-gray-500'}`}
                >
                  {d.label}
                </div>
              ))}
            </div>

            {/* Rows + today line */}
            <div className="relative">
              {todayOffset >= 0 && todayOffset < renderedDays && (
                <div
                  className="absolute top-0 bottom-0 z-[15] pointer-events-none"
                  style={{ left: todayOffset * dayWidth + dayWidth / 2, width: 2, background: '#3b82f6' }}
                >
                  <div className="absolute -top-0 -left-[3px] w-2 h-2 rounded-full bg-blue-500" />
                </div>
              )}

              {view === 'asset' ? (
                rowEntries.map((entry, i) => {
                  if (entry.type === 'divider') {
                    const dividerBg = entry.accent === 'warn' ? 'bg-rose-50' : 'bg-gray-100'
                    return <div key={`d-${i}`} className={`h-6 border-b border-gray-200 ${dividerBg}`} />
                  }
                  if (entry.type === 'taskBand') {
                    return (
                      <div
                        key={`tb-${i}`}
                        style={{ height: entry.bandHeight }}
                        className="relative border-b-2 border-gray-300 bg-rose-50/30"
                      >
                        {/* Grid */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {dayMeta.map(d => (
                            <div
                              key={d.ds}
                              style={{ width: dayWidth, minWidth: dayWidth }}
                              className={`flex-shrink-0 border-r border-gray-200 ${d.weekend ? 'bg-gray-200/60' : ''}`}
                            />
                          ))}
                        </div>
                        {/* Task chips — placed on their scheduled day; same-day
                            tasks stack vertically within that day's column. */}
                        {entry.tasks.map((t: any, k: number) => {
                          const bar = getBar(t.start, t.end)
                          if (!bar) return null
                          const isPickup = t.taskType === 'PICKUP'
                          const label = isPickup ? 'Pickup' : 'Delivery'
                          const detail = [t.jobName, t.scheduledTime, t.siteAddress, t.deliveryItems].filter(Boolean).join(' · ')
                          const chipColor = isPickup
                            ? 'bg-violet-200 border-violet-500 text-violet-900 hover:bg-violet-300'
                            : 'bg-amber-200 border-amber-500 text-amber-900 hover:bg-amber-300'
                          return (
                            <div
                              key={`tk-${k}`}
                              // Tasks are NOT draggable — click opens the assign flow. (No
                              // pointer-drag handlers here, so no ghost is ever created for
                              // a task; drag-reassign is only for assigned unit bars.)
                              className={`absolute rounded border border-dashed flex items-center overflow-hidden ${chipColor} ${canAssignTasks ? 'cursor-pointer transition-colors' : ''}`}
                              style={{ left: bar.left, width: Math.max(dayWidth - 2, 24), top: t.stackIndex * TASK_SLOT + 3, height: TASK_CHIP_H }}
                              onClick={canAssignTasks ? (ev) => { ev.stopPropagation(); setAssignTask(t) } : undefined}
                              title={`${label} — ${t.clientName}${detail ? ` · ${detail}` : ''}${canAssignTasks ? ' · click to assign driver + tow vehicle' : ''}`}
                            >
                              <span className="text-[8px] font-bold truncate whitespace-nowrap px-1 leading-none">
                                {isPickup ? '↑' : '↓'}{t.scheduledTime ? ` ${t.scheduledTime}` : ` ${t.clientName}`}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  }
                  return (
                    <TimelineUnitRow
                      key={`u-${entry.unit.assetId}`}
                      entry={entry}
                      dayMeta={dayMeta}
                      dayWidth={dayWidth}
                      renderedStartDate={renderedStartDate}
                      renderedDays={renderedDays}
                      lastRenderedDate={dates[dates.length - 1]}
                      canBindUnit={canBindUnit}
                      canSetStatus={canSetStatus}
                      dropState={dropStateFor(entry.unit.assetId)}
                      onRowClick={openHoldOnAssetRow}
                      onBarPointerDown={onBarPointerDown}
                      onBarPointerMove={onBarPointerMove}
                      onBarPointerUp={onBarPointerUp}
                      onBarClick={onBarClick}
                      onBackupClick={onBackupClick}
                    />
                  )
                })
              ) : (
                jobs.map((job, i) => (
                  <div key={i} className="relative h-8 border-b border-gray-100">
                    <div className="absolute inset-0 flex pointer-events-none">
                      {dayMeta.map(d => (
                        <div
                          key={d.ds}
                          style={{ width: dayWidth, minWidth: dayWidth }}
                          className={`flex-shrink-0 border-r border-gray-200 ${d.weekend ? 'bg-gray-200/60' : ''}`}
                        />
                      ))}
                    </div>
                    {(() => {
                      const bar = getBar(job.startDate, job.endDate)
                      if (!bar) return null
                      const sc = barColor(job.status, job.blindPickup)
                      return (
                        <div
                          className={`absolute top-1 h-6 rounded-md ${sc.bg} border ${sc.border} flex items-center px-1.5 cursor-pointer hover:opacity-90 overflow-hidden`}
                          style={{ left: bar.left, width: bar.width }}
                          onClick={() => setSelected(job)}
                        >
                          <span className={`text-[9px] font-bold ${sc.text} truncate whitespace-nowrap`}>
                            {job.company} · {job.items?.length} unit{job.items?.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-[480px] max-w-[95vw] p-5 shadow-2xl border border-gray-200" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                {selected.isUnit ? (
                  <>
                    <div className="text-[10px] text-gray-400 uppercase font-bold">{selected.resourceName}</div>
                    <h3 className="text-lg font-bold text-gray-900">{selected.unitName}</h3>
                    <div className="text-[13px] text-gray-500">{selected.clientName}</div>
                    {selected.jobName && <div className="text-[11px] text-gray-400 mt-0.5">{selected.jobName}</div>}
                    {selected.agent && <div className="text-[11px] text-gray-400">Agent: {selected.agent}</div>}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {selected.jobId && (
                        <Link
                          href={`/jobs/${selected.jobId}`}
                          className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                        >
                          {selected.jobCode || 'Job'} →
                        </Link>
                      )}
                      {selected.rwOrderNumber && (
                        <a href={`/jobs?rw=${selected.rwOrderNumber}`} className="text-[10px] text-blue-600 hover:underline">RW #{selected.rwOrderNumber} →</a>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[10px] text-gray-400 uppercase font-bold">{selected.status?.toUpperCase()} · {selected.jobNum}</div>
                    <h3 className="text-lg font-bold text-gray-900">{selected.company}</h3>
                    {selected.jobName && <div className="text-[13px] text-gray-500">{selected.jobName}</div>}
                    {selected.agent && <div className="text-[11px] text-gray-400 mt-0.5">Agent: {selected.agent}</div>}
                    {selected.contact && selected.contact !== selected.company && <div className="text-[11px] text-gray-400">Contact: {selected.contact}</div>}
                    {selected.jobId && (
                      <Link
                        href={`/jobs/${selected.jobId}`}
                        className="inline-block text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 mt-1"
                      >
                        {selected.jobCode || 'Job'} →
                      </Link>
                    )}
                  </>
                )}
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>

            {selected.isUnit ? (
              <div className="space-y-1 text-[12px]">
                {selected.isBackup && (
                  <div className="px-3 py-2 mb-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] font-semibold">
                    {selected.holdRank === 2 ? '2nd hold' : selected.holdRank === 3 ? '3rd hold' : `${selected.holdRank}th hold`} — queued behind primary
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-400">Dates</span>
                  <span className="font-semibold">{fMonth(selected.start)} – {fMonth(selected.end)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-400">Status</span>
                  <span className="font-semibold capitalize">{selected.status}</span>
                </div>
                {selected.adminNotes && (
                  <div className="py-2 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 mt-2">{selected.adminNotes}</div>
                )}

                {/* Hold lifecycle actions.
                    PRIMARY (rank 1): Book + Release.
                    BACKUP  (rank ≥2): Promote + Release.
                    Records without bookingId/bookingItemId render
                    read-only. */}
                {(selected.bookingId || selected.bookingItemId) && (
                  <div className="pt-3 mt-3 border-t border-gray-200 space-y-2">
                    {actionSuccess && (
                      <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1.5">{actionSuccess}</div>
                    )}
                    {actionError && (
                      <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">{actionError}</div>
                    )}
                    <div className="flex items-center gap-2">
                      {selected.isBackup ? (
                        // Promote + Release are SALES actions (canCreateBooking) —
                        // per Wes they re-rank / terminate the reservation queue,
                        // which is a booking decision, not assignment. Fleet sees
                        // a read-only note; the endpoints 403 them too.
                        canSetStatus ? (
                          <>
                            <button
                              onClick={handlePromote}
                              disabled={!!actionPending}
                              className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-[11px] font-semibold px-3 py-1.5 rounded"
                            >
                              {actionPending === 'promote' ? 'Promoting…' : 'Promote'}
                            </button>
                            <button
                              onClick={handleRelease}
                              disabled={!!actionPending}
                              className="border border-zinc-300 hover:bg-zinc-50 disabled:opacity-40 text-zinc-800 text-[11px] font-semibold px-3 py-1.5 rounded"
                            >
                              {actionPending === 'release' ? 'Releasing…' : 'Release backup'}
                            </button>
                            <span className="text-[10px] text-gray-400 ml-auto">
                              Promote re-ranks the queue; Book becomes available after.
                            </span>
                          </>
                        ) : (
                          <span className="text-[10px] text-gray-400">
                            Backup hold — promote/release is a sales action.
                          </span>
                        )
                      ) : (
                        <>
                          {/* Sales status control — set among Inquiry / Hold /
                              Booked / Cancelled. Booked needs no rental agreement.
                              Shown to canCreateBooking users on bookings they own
                              (ADMIN: any). Others see a read-only status pill. */}
                          {canSetStatus && (sessionRole === 'ADMIN' || (selected.agentId && selected.agentId === sessionUserId)) ? (
                            <div className="flex items-center gap-1">
                              {([['inquiry', 'Inquiry'], ['hold', 'Hold'], ['booked', 'Booked'], ['cancelled', 'Cancelled']] as const).map(([val, lbl]) => {
                                const active = selected.status === val
                                return (
                                  <button
                                    key={val}
                                    onClick={() => handleSetStatus(val)}
                                    disabled={!!actionPending || active}
                                    aria-pressed={active}
                                    className={`text-[11px] font-semibold px-2.5 py-1.5 rounded border transition-colors ${active ? 'bg-zinc-800 text-white border-zinc-800' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50'} disabled:cursor-default`}
                                  >
                                    {actionPending === 'status' && !active ? '…' : lbl}
                                  </button>
                                )
                              })}
                            </div>
                          ) : (
                            <span className="text-[11px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded px-2.5 py-1.5 capitalize">
                              {selected.status}
                            </span>
                          )}
                          {/* Release is a SALES action (canCreateBooking) — see note
                              on the backup branch. Fleet keeps only assignment. */}
                          {canSetStatus && (
                            <button
                              onClick={handleRelease}
                              disabled={!!actionPending}
                              className="border border-zinc-300 hover:bg-zinc-50 disabled:opacity-40 text-zinc-800 text-[11px] font-semibold px-3 py-1.5 rounded"
                            >
                              {actionPending === 'release' ? 'Releasing…' : 'Release'}
                            </button>
                          )}
                          <span className="text-[10px] text-gray-400 ml-auto">
                            Backups (if any) stay queued — no auto-promote.
                          </span>
                        </>
                      )}
                    </div>
                    {/* Reschedule (dates) — sales owners only; read-only otherwise.
                        Validated against the same buffer/overlap checks creation
                        uses; buffer encroachment offers an override. */}
                    {!selected.isBackup && selected.bookingId && (
                      canSetStatus && (sessionRole === 'ADMIN' || (selected.agentId && selected.agentId === sessionUserId)) ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] uppercase tracking-wide text-gray-400">Dates</span>
                            <input
                              type="date"
                              value={dateDraft.start}
                              onChange={(e) => setDateDraft((d) => ({ start: e.target.value, end: d.end && d.end < e.target.value ? e.target.value : d.end }))}
                              className="border border-zinc-300 rounded px-1.5 py-1 text-[11px]"
                            />
                            <span className="text-gray-400">–</span>
                            <input
                              type="date"
                              value={dateDraft.end}
                              min={dateDraft.start}
                              onChange={(e) => setDateDraft((d) => ({ ...d, end: e.target.value }))}
                              className="border border-zinc-300 rounded px-1.5 py-1 text-[11px]"
                            />
                            <button
                              onClick={() => handleSetDates(false)}
                              disabled={!!actionPending || (dateDraft.start === selected.start && dateDraft.end === selected.end)}
                              className="bg-zinc-800 hover:bg-black disabled:bg-zinc-300 text-white text-[11px] font-semibold px-3 py-1.5 rounded"
                            >
                              {actionPending === 'dates' ? 'Saving…' : 'Save dates'}
                            </button>
                          </div>
                          {dateWarn && (
                            <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-center gap-2 flex-wrap">
                              <span>{dateWarn}</span>
                              <button
                                onClick={() => handleSetDates(true)}
                                disabled={!!actionPending}
                                className="font-semibold underline hover:text-amber-900"
                              >
                                Override buffer &amp; save
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-500">
                          <span className="text-gray-400">Dates:</span>{' '}
                          <span className="font-semibold">{fMonth(selected.start)} – {fMonth(selected.end)}</span>
                        </div>
                      )
                    )}
                    {/* Unit assignment is SALES (canCreateBooking) — re-split. */}
                    {canBindUnit && selected.bookingItemId && (
                      <button
                        onClick={() => { setAssignBookingItemId(selected.bookingItemId); setSelected(null) }}
                        className="w-full border border-zinc-300 hover:bg-zinc-50 text-zinc-800 text-[11px] font-semibold px-3 py-1.5 rounded"
                      >
                        Assign / change units
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Units on this job</div>
                {selected.items?.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between py-2 border-b border-gray-100 last:border-0 text-[12px]">
                    <div>
                      <div className="font-semibold text-gray-900">{item.unit}</div>
                      <div className="text-gray-400 text-[10px]">{item.resourceName}</div>
                    </div>
                    <div className="text-right text-gray-500">
                      <div>{fMonth(item.start)} – {fMonth(item.end)}</div>
                    </div>
                  </div>
                ))}
                {selected.items?.[0]?.adminNotes && (
                  <div className="py-2 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 mt-2">{selected.items[0].adminNotes}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* +Hold modal — opens from an asset-row click only
          (asset-bound). The category-only entry point now lives on
          the global "+ New" menu in the dashboard top bar. */}
      {holdModal && (
        <NewHoldModal
          categoryId={holdModal.categoryId}
          categoryName={holdModal.categoryName}
          startDate={holdModal.startDate}
          endDate={holdModal.endDate}
          bufferDays={1}
          asBackup={holdModal.asBackup}
          asset={holdModal.asset}
          canBindUnit={canBindUnit}
          onClose={() => setHoldModal(null)}
          onCreated={() => {
            setHoldModal(null)
            refreshTimeline()
          }}
        />
      )}

      {/* Assign-units modal — opens from a "needs assignment" lane
          bar click. Reuses the existing per-BookingItem picker so
          tier-sorted candidate + buffer-warn paths work uniformly. */}
      {assignBookingItemId && (
        <AssignUnitsModal
          bookingItemId={assignBookingItemId}
          bufferDays={1}
          onClose={() => setAssignBookingItemId(null)}
          onChanged={() => refreshTimeline()}
        />
      )}

      {/* Assign delivery/pickup task — fleet sets driver + tow vehicle.
          Setting a tow vehicle drops the task from the needs-assignment lane. */}
      {assignTask && (
        <AssignTaskModal
          task={assignTask}
          onClose={() => setAssignTask(null)}
          onAssigned={() => { setAssignTask(null); refreshTimeline() }}
        />
      )}

      {/* Asset summary — vehicle at a glance (name click / "…" menu). Edits
          (notes + condition tier) are fleet-gated; tier changes re-color the
          board dot via the refresh. */}
      {summaryAssetId && (
        <AssetSummaryPanel
          assetId={summaryAssetId}
          canEdit={canFleetOps}
          onClose={() => setSummaryAssetId(null)}
          onChanged={refreshTimeline}
        />
      )}

      {/* Drag-to-reassign ghost — follows the pointer; pointer-events-none so the
          row hit-test (elementFromPoint) sees the unit rows underneath.
          PERF: position lives OUTSIDE React — the callback ref seeds the
          transform from ghostPosRef and pointermove mutates style.transform
          directly, so React only touches this node when the TARGET changes
          (ring color / arrow label). */}
      {drag && (() => {
        const overTarget = !!drag.targetAssetId && drag.targetAssetId !== drag.fromAssetId
        const ring = drag.targetValid ? 'ring-green-500' : overTarget ? 'ring-rose-400' : 'ring-gray-300'
        return (
          <div
            ref={(el) => {
              ghostRef.current = el
              if (el) {
                el.style.transform = `translate(${ghostPosRef.current.x - drag.grabDX}px, ${ghostPosRef.current.y - drag.grabDY}px)`
              }
            }}
            className={`fixed z-[60] pointer-events-none rounded-md border ${drag.bg} ${drag.border} flex items-center px-1.5 overflow-hidden opacity-80 shadow-lg ring-2 ${ring}`}
            style={{ left: 0, top: 0, width: drag.width, height: drag.height, willChange: 'transform' }}
          >
            <span className={`text-[9px] font-bold ${drag.text} truncate whitespace-nowrap`}>
              {drag.label}{overTarget ? ` ${drag.targetValid ? '→' : '✕'} ${drag.targetUnit}` : ''}
            </span>
          </div>
        )
      })()}

      {/* Buffer-adjacent drop — same override the units drawer offers. */}
      {dragBuffer && (
        <>
          <div className="fixed inset-0 z-[65] bg-black/20" onClick={() => setDragBuffer(null)} />
          <div className="fixed z-[66] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-amber-300 rounded-lg shadow-xl p-4 w-80 text-sm">
            <div className="font-semibold text-amber-800 mb-1">Turnaround buffer</div>
            <div className="text-xs text-gray-700 mb-3">{dragBuffer.reason} Move to {dragBuffer.toUnit} anyway?</div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDragBuffer(null)} disabled={dragBusy} className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 disabled:opacity-40">Cancel</button>
              <button
                onClick={() => doReassign(dragBuffer.bookingItemId, dragBuffer.fromAssetId, dragBuffer.toAssetId, dragBuffer.toUnit, true)}
                disabled={dragBusy}
                className="text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded disabled:opacity-40"
              >
                {dragBusy ? 'Moving…' : 'Override & move'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Reassign error / conflict — readable reason; the bar never left its row. */}
      {dragErr && (
        <div
          className="fixed z-[60] bottom-4 left-1/2 -translate-x-1/2 bg-rose-600 text-white text-xs px-3 py-2 rounded-lg shadow-lg max-w-md cursor-pointer"
          onClick={() => setDragErr(null)}
        >
          {dragErr}
        </div>
      )}

      {/* Unit N/A action menu — fixed so the scrolling label column can't clip it. */}
      {unitMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setUnitMenu(null)} />
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-52 py-1"
            style={{ left: Math.max(8, unitMenu.x - 208), top: unitMenu.y + 4 }}
          >
            {canSetStatus && !unitMenu.isNa && (
              <button onClick={() => handleUnitNa(unitMenu.assetId, 'refer')} disabled={naBusy}
                className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50 disabled:opacity-40">
                Refer to Maintenance
              </button>
            )}
            {canFleetOps && !unitMenu.isNa && (
              <button onClick={() => handleUnitNa(unitMenu.assetId, 'mark-na')} disabled={naBusy}
                className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50 disabled:opacity-40">
                Mark Not Available
              </button>
            )}
            {canFleetOps && unitMenu.isNa && (
              <button onClick={() => handleUnitNa(unitMenu.assetId, 'clear')} disabled={naBusy}
                className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50 disabled:opacity-40">
                Clear · back in service
              </button>
            )}
            {/* Condition tier now lives in the asset summary panel (canonical
                setter home) — this menu just points there. */}
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => { setSummaryAssetId(unitMenu.assetId); setUnitMenu(null) }}
              className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50 flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TIER_COLORS[unitMenu.tier] || '#9ca3af' }} />
              Vehicle summary · condition tier
            </button>
            {naErr && <div className="px-3 py-1 text-[10px] text-rose-600">{naErr}</div>}
          </div>
        </>
      )}
    </div>
  )
}
