'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { NewHoldModal } from '@/components/scheduling/NewHoldModal';
import { AssignUnitsModal } from '@/components/scheduling/AssignUnitsModal';

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

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  booked:  { bg: 'bg-blue-400',   border: 'border-blue-500',   text: 'text-white' },
  active:  { bg: 'bg-emerald-400',border: 'border-emerald-500',text: 'text-white' },
  hold:    { bg: 'bg-amber-300',  border: 'border-amber-400',  text: 'text-amber-900' },
  inquiry: { bg: 'bg-sky-200',    border: 'border-sky-300',    text: 'text-sky-800' },
  quoted:  { bg: 'bg-purple-300', border: 'border-purple-400', text: 'text-purple-900' },
}

const CAT_LABELS: Record<string, string> = {
  cube: 'Cube', cargo: 'Cargo', pass: 'Pass Van', pop: 'PopVan',
  cam: 'Cam Cube', dlux: 'DLUX', scout: 'Scout', studio: 'Studio',
  stakebed: 'Stakebed', general: 'Other',
}

export default function GanttPage() {
  const [view, setView] = useState<'asset' | 'job'>('asset')
  const [weeks, setWeeks] = useState(2)
  const [catFilter, setCatFilter] = useState('all')
  const [jobs, setJobs] = useState<any[]>([])
  const [units, setUnits] = useState<any[]>([])
  const [unassignedHolds, setUnassignedHolds] = useState<any[]>([])
  const [assignBookingItemId, setAssignBookingItemId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<any>(null)
  const [actionPending, setActionPending] = useState<null | 'book' | 'release' | 'promote'>(null)
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
  const [categories, setCategories] = useState<Array<{ id: string; name: string; slug: string }>>([])
  const [showCategoryPickerForHold, setShowCategoryPickerForHold] = useState(false)

  useEffect(() => {
    fetch('/api/timeline-native')
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
  }, [])

  useEffect(() => {
    if (categories.length > 0) return
    fetch('/api/scheduling/categories')
      .then((r) => r.json())
      .then((d) => { if (d.ok) setCategories(d.categories || []) })
      .catch(() => {})
  }, [categories.length])

  const startDate = addDays(today, -3)
  const totalDays = weeks * 7
  const dates = Array.from({ length: totalDays }, (_, i) => addDays(startDate, i))
  const dayWidth = weeks <= 2 ? 48 : weeks <= 3 ? 36 : 28
  const todayOffset = diffDays(startDate, today)

  // ── +Hold entry point: row click on an asset → modal pre-filled
  //    with that asset + clicked date. If the clicked date overlaps
  //    an existing booking on that unit, the modal opens in BACKUP
  //    mode (per "backup has dibs"); otherwise PRIMARY. Server still
  //    enforces availability — this is just UX. ──
  function openHoldOnAssetRow(unit: any, e: React.MouseEvent<HTMLDivElement>) {
    if (!unit?.assetId || !unit?.categoryId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const dayIndex = Math.max(0, Math.min(totalDays - 1, Math.floor(x / dayWidth)))
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
  }

  function openCategoryHold(cat: { id: string; name: string }) {
    setHoldModal({
      categoryId: cat.id,
      categoryName: cat.name,
      startDate: today,
      endDate: addDays(today, 1),
      asBackup: false,
    })
    setShowCategoryPickerForHold(false)
  }

  // ── Refresh the timeline data after an action. Kept inline so the
  //    fetch URL stays consistent with the initial load. ──
  function refreshTimeline() {
    setLoading(true)
    fetch('/api/timeline-native')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setJobs(d.jobs || [])
          setUnits(d.units || [])
          setUnassignedHolds(d.unassignedHolds || [])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  function closeModal() {
    setSelected(null)
    setActionPending(null)
    setActionError(null)
    setActionSuccess(null)
  }

  // ── PART 4 actions. Book/Release on a bar click.
  //    PRIMARY (holdRank=1):
  //      Book    → POST /api/scheduling/bookings/[bookingId]/confirm
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
  async function handleBook() {
    if (!selected) return
    const bookingId: string | undefined = selected.bookingId
    if (!bookingId) {
      setActionError('Missing bookingId on the selected bar — refresh and retry.')
      return
    }
    setActionPending('book')
    setActionError(null)
    setActionSuccess(null)
    try {
      const res = await fetch(`/api/scheduling/bookings/${bookingId}/confirm`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.reason || json.error || `confirm failed (${res.status})`)
      }
      setActionSuccess(json.alreadyConfirmed ? 'Already confirmed.' : 'Booked.')
      // Reflect the new state in the open popup so the Book button
      // disappears / button copy updates without a re-click.
      setSelected((prev: any) => prev ? { ...prev, bookingStatus: 'CONFIRMED', status: 'booked' } : prev)
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

  function getBar(start: string, end: string) {
    const s = Math.max(0, diffDays(startDate, start))
    const e = Math.min(totalDays - 1, diffDays(startDate, end))
    if (e < 0 || s >= totalDays) return null
    return { left: s * dayWidth, width: Math.max((e - s + 1) * dayWidth - 2, dayWidth - 2) }
  }

  const allCats = [...new Set(units.map(u => u.cat))].sort()
  const filteredUnits = catFilter === 'all' ? units : units.filter(u => u.cat === catFilter)

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
    | { type: 'needsAssign'; hold: any }
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
    const sorted = [...filteredUnits].sort((a, b) => {
      const av = isBookedInWindow(a) ? 0 : 1
      const bv = isBookedInWindow(b) ? 0 : 1
      return av - bv
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
      entries.push({
        type: 'divider',
        label: `${visibleUnassigned.length} needs assignment`,
        accent: 'warn',
      })
      for (const h of visibleUnassigned) entries.push({ type: 'needsAssign', hold: h })
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
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900">Timeline</h1>
          {loading && <span className="text-[11px] text-gray-400">Loading...</span>}
          {!loading && <span className="text-[11px] text-gray-400">{units.length} units · {jobs.length} jobs · Live</span>}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setView('asset')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'asset' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By Asset</button>
            <button onClick={() => setView('job')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'job' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By Job</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {view === 'asset' && (
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white">
              <option value="all">All Categories</option>
              {allCats.map(c => <option key={c} value={c}>{CAT_LABELS[c] || c}</option>)}
            </select>
          )}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[1,2,3,4].map(w => (
              <button key={w} onClick={() => setWeeks(w)} className={`px-2 py-1 rounded-md text-[10px] font-semibold ${weeks === w ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{w}W</button>
            ))}
          </div>
          <div className="relative">
            <button
              onClick={() => setShowCategoryPickerForHold(v => !v)}
              className="bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold px-3 py-1.5 rounded"
            >
              + New Hold
            </button>
            {showCategoryPickerForHold && categories.length > 0 && (
              <div
                className="absolute right-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded-lg shadow-lg w-56 max-h-80 overflow-auto"
                onMouseLeave={() => setShowCategoryPickerForHold(false)}
              >
                <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  Pick a category
                </div>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openCategoryHold(c)}
                    className="block w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-2 text-[10px] flex-wrap">
        {[
          { label: 'Booked', color: 'bg-blue-400' },
          { label: 'Active', color: 'bg-emerald-400' },
          { label: 'Hold', color: 'bg-amber-300' },
          { label: 'Inquiry', color: 'bg-sky-200' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className={`w-3 h-2 rounded-sm ${l.color}`} />
            <span className="text-gray-500">{l.label}</span>
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
        className="border border-gray-200 rounded-lg overflow-auto bg-white relative"
        style={{ height: 'calc(100vh - 210px)' }}
      >
        <div className="flex" style={{ width: 192 + totalDays * dayWidth, minWidth: '100%' }}>
          {/* ── LEFT: labels column (sticky left:0) ── */}
          <div className="w-48 flex-shrink-0 sticky left-0 z-20 bg-gray-50 border-r border-gray-200">
            {/* Top-left corner — sticky on both axes */}
            <div className="h-10 border-b border-gray-200 px-3 flex items-center text-[10px] font-bold text-gray-400 uppercase bg-gray-50 sticky top-0 z-30">
              {view === 'asset' ? 'Unit' : 'Client'}
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
                if (entry.type === 'needsAssign') {
                  return (
                    <div
                      key={`na-${i}`}
                      className="h-8 border-b border-gray-100 px-3 flex items-center gap-2 bg-rose-50/40"
                    >
                      <div className="w-2 h-2 rounded-full flex-shrink-0 bg-rose-400" />
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-gray-900 truncate">
                          {entry.hold.categoryName || entry.hold.resourceName || '—'}
                        </div>
                        <div className="text-[9px] text-rose-600 truncate italic">unassigned</div>
                      </div>
                    </div>
                  )
                }
                const hasBackups = entry.backupBookings.length > 0
                return (
                  <div key={`u-${i}`}>
                    <div className="h-8 border-b border-gray-100 px-3 flex items-center gap-2 bg-gray-50">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CAT_COLORS[entry.unit.cat] || '#9ca3af' }} />
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-gray-900 truncate">{entry.unit.unitName}</div>
                        <div className="text-[9px] text-gray-400 truncate">{entry.unit.resourceName}</div>
                      </div>
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
          <div className="flex-shrink-0" style={{ width: totalDays * dayWidth }}>
            {/* Sticky date header */}
            <div className="flex h-10 border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
              {dates.map(ds => {
                const isToday = ds === today
                const isWeekend = [0,6].includes(new Date(ds + 'T12:00:00').getDay())
                return (
                  <div
                    key={ds}
                    style={{ width: dayWidth, minWidth: dayWidth }}
                    className={`flex-shrink-0 flex items-center justify-center text-[10px] border-r border-gray-100 ${isToday ? 'bg-blue-50 font-bold text-blue-600' : isWeekend ? 'bg-gray-100/50 text-gray-400' : 'text-gray-500'}`}
                  >
                    {fDay(ds)}
                  </div>
                )
              })}
            </div>

            {/* Rows + today line */}
            <div className="relative">
              {todayOffset >= 0 && todayOffset < totalDays && (
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
                  if (entry.type === 'needsAssign') {
                    const h = entry.hold
                    const bar = getBar(h.start, h.end)
                    return (
                      <div key={`na-${i}`} className="relative h-8 border-b border-gray-100 bg-rose-50/40">
                        {/* Grid */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {dates.map(ds => (
                            <div
                              key={ds}
                              style={{ width: dayWidth, minWidth: dayWidth }}
                              className={`flex-shrink-0 border-r border-gray-100/50 ${[0,6].includes(new Date(ds + 'T12:00:00').getDay()) ? 'bg-gray-50/50' : ''}`}
                            />
                          ))}
                        </div>
                        {bar && (
                          <div
                            className="absolute top-1 h-6 rounded-md bg-amber-200 border border-dashed border-amber-500 flex items-center px-1.5 cursor-pointer hover:bg-amber-300 transition-colors overflow-hidden"
                            style={{ left: bar.left, width: bar.width }}
                            onClick={(ev) => { ev.stopPropagation(); setAssignBookingItemId(h.bookingItemId) }}
                            title={`Click to assign a unit — ${h.clientName}${h.jobName ? ` · ${h.jobName}` : ''}`}
                          >
                            <span className="text-[9px] font-bold text-amber-900 truncate whitespace-nowrap">
                              ⚠ {h.clientName}{h.jobName ? ` · ${h.jobName}` : ''} · qty {h.quantity} · assign →
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  }
                  const hasBackups = entry.backupBookings.length > 0
                  return (
                    <div key={`u-${i}`}>
                      {/* Main row — primary bars only.
                          Row-level onClick fires on empty-span clicks
                          (bar onClicks stopPropagation). Native-only
                          per the brief — gated inside openHoldOnAssetRow. */}
                      <div
                        className="relative h-8 border-b border-gray-100 cursor-pointer hover:bg-blue-50/20"
                        onClick={(ev) => openHoldOnAssetRow(entry.unit, ev)}
                      >
                        {/* Grid */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {dates.map(ds => (
                            <div
                              key={ds}
                              style={{ width: dayWidth, minWidth: dayWidth }}
                              className={`flex-shrink-0 border-r border-gray-100/50 ${[0,6].includes(new Date(ds + 'T12:00:00').getDay()) ? 'bg-gray-50/50' : ''}`}
                            />
                          ))}
                        </div>
                        {/* Primary bars */}
                        {entry.primaryBookings.map((b: any, j: number) => {
                          const bar = getBar(b.start, b.end)
                          if (!bar) return null
                          const sc = STATUS_COLORS[b.status] || STATUS_COLORS.booked
                          return (
                            <div
                              key={`p-${j}`}
                              className={`absolute top-1 h-6 rounded-md ${sc.bg} border ${sc.border} flex items-center px-1.5 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden`}
                              style={{ left: bar.left, width: bar.width }}
                              onClick={(ev) => {
                                ev.stopPropagation()
                                setSelected({ ...b, unitName: entry.unit.unitName, isUnit: true, holdRank: 1 })
                              }}
                            >
                              <span className={`text-[9px] font-bold ${sc.text} truncate whitespace-nowrap`}>
                                {b.clientName}{b.jobName ? ` · ${b.jobName}` : ''} · {fMonth(b.start)}–{fMonth(b.end)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      {/* Backup sub-lane — greyed, rank-2+ bars stacked here.
                          Empty-span clicks here delegate to the same
                          asset-row handler; overlap detection will
                          pick the right primary/backup mode. */}
                      {hasBackups && (
                        <div
                          className="relative h-8 border-b border-gray-100 bg-gray-100/70 cursor-pointer hover:bg-gray-200/70"
                          onClick={(ev) => openHoldOnAssetRow(entry.unit, ev)}
                        >
                          {/* Grid (lighter on the sub-lane) */}
                          <div className="absolute inset-0 flex pointer-events-none">
                            {dates.map(ds => (
                              <div
                                key={ds}
                                style={{ width: dayWidth, minWidth: dayWidth }}
                                className={`flex-shrink-0 border-r border-gray-200/40 ${[0,6].includes(new Date(ds + 'T12:00:00').getDay()) ? 'bg-gray-200/30' : ''}`}
                              />
                            ))}
                          </div>
                          {entry.backupBookings.map((b: any, j: number) => {
                            const bar = getBar(b.start, b.end)
                            if (!bar) return null
                            const rank = typeof b.holdRank === 'number' ? b.holdRank : 2
                            const rankLabel = rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`
                            return (
                              <div
                                key={`b-${j}`}
                                className="absolute top-1 h-6 rounded-md bg-gray-300/70 border border-dashed border-gray-400 flex items-center px-1.5 cursor-pointer hover:bg-gray-300 transition-opacity overflow-hidden"
                                style={{ left: bar.left, width: bar.width }}
                                onClick={(ev) => {
                                  ev.stopPropagation()
                                  setSelected({ ...b, unitName: entry.unit.unitName, isUnit: true, holdRank: rank, isBackup: true })
                                }}
                                title={`${rankLabel} hold — ${b.clientName}${b.jobName ? ` · ${b.jobName}` : ''}`}
                              >
                                <span className="text-[9px] font-semibold text-gray-700 truncate whitespace-nowrap">
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
              ) : (
                jobs.map((job, i) => (
                  <div key={i} className="relative h-8 border-b border-gray-100">
                    <div className="absolute inset-0 flex pointer-events-none">
                      {dates.map(ds => (
                        <div
                          key={ds}
                          style={{ width: dayWidth, minWidth: dayWidth }}
                          className={`flex-shrink-0 border-r border-gray-100/50 ${[0,6].includes(new Date(ds + 'T12:00:00').getDay()) ? 'bg-gray-50/50' : ''}`}
                        />
                      ))}
                    </div>
                    {(() => {
                      const bar = getBar(job.startDate, job.endDate)
                      if (!bar) return null
                      const sc = STATUS_COLORS[job.status] || STATUS_COLORS.booked
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
                        <>
                          {selected.bookingStatus !== 'CONFIRMED' && (
                            <button
                              onClick={handleBook}
                              disabled={!!actionPending}
                              className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-[11px] font-semibold px-3 py-1.5 rounded"
                            >
                              {actionPending === 'book' ? 'Booking…' : 'Book'}
                            </button>
                          )}
                          {selected.bookingStatus === 'CONFIRMED' && (
                            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1.5">
                              Confirmed
                            </span>
                          )}
                          <button
                            onClick={handleRelease}
                            disabled={!!actionPending}
                            className="border border-zinc-300 hover:bg-zinc-50 disabled:opacity-40 text-zinc-800 text-[11px] font-semibold px-3 py-1.5 rounded"
                          >
                            {actionPending === 'release' ? 'Releasing…' : 'Release'}
                          </button>
                          <span className="text-[10px] text-gray-400 ml-auto">
                            Backups (if any) stay queued — no auto-promote.
                          </span>
                        </>
                      )}
                    </div>
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

      {/* +Hold modal — native-source only.
          Opens from an asset-row click (asset-bound) or the
          "+ New Hold" header button (category-only). */}
      {holdModal && (
        <NewHoldModal
          categoryId={holdModal.categoryId}
          categoryName={holdModal.categoryName}
          startDate={holdModal.startDate}
          endDate={holdModal.endDate}
          bufferDays={1}
          asBackup={holdModal.asBackup}
          asset={holdModal.asset}
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
    </div>
  )
}
