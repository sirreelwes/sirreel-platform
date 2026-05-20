'use client'

import { useEffect, useMemo, useState } from 'react'

/**
 * Dispatch — Planyo → Booking linker (formerly Planyo → RW linker).
 *
 * Reads orphan Reservations from /api/dispatch/orphans (grouped by
 * planyoCartId so multi-unit jobs cluster). Each card carries an
 * auto-match suggestion + confidence; HIGH ones can be bulk-linked.
 *
 * Linking writes Reservation.bookingId for every reservation in the
 * cart (one Booking owns the whole multi-unit job).
 */

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'

interface MatchResult {
  bookingId: string
  bookingNumber: string
  companyName: string | null
  jobName: string | null
  score: number
  reasons: string[]
}

interface OrphanUnit {
  reservationId: string
  planyoReservationId: string | null
  unitName: string
  category: string | null
  startTime: string
  endTime: string
  status: string
  notes: string | null
}

interface OrphanGroup {
  key: string
  planyoCartId: string | null
  planyoCompany: string | null
  planyoJobName: string | null
  planyoAgent: string | null
  unitCount: number
  units: OrphanUnit[]
  match: {
    top: MatchResult | null
    confidence: Confidence
    alternates: MatchResult[]
  }
}

interface Counts {
  total: number
  high: number
  medium: number
  low: number
  none: number
}

interface BookingHit {
  id: string
  bookingNumber: string
  jobName: string | null
  productionName: string | null
  company: { name: string } | null
  startDate: string | null
  endDate: string | null
}

function fmt(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const CONFIDENCE_STYLE: Record<Confidence, { label: string; bg: string; text: string; border: string }> = {
  HIGH:   { label: 'High match',   bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  MEDIUM: { label: 'Medium match', bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  LOW:    { label: 'Low match',    bg: 'bg-zinc-50',    text: 'text-zinc-600',    border: 'border-zinc-200' },
  NONE:   { label: 'No match',     bg: 'bg-zinc-50',    text: 'text-zinc-500',    border: 'border-zinc-200' },
}

export default function DispatchPage() {
  const [counts, setCounts] = useState<Counts | null>(null)
  const [groups, setGroups] = useState<OrphanGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Confidence | 'ALL'>('ALL')
  const [linking, setLinking] = useState<Set<string>>(new Set())
  const [linked, setLinked] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [overrideForKey, setOverrideForKey] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<BookingHit[]>([])
  const [searching, setSearching] = useState(false)

  const reload = () => {
    setLoading(true)
    fetch('/api/dispatch/orphans')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setCounts(d.counts)
          setGroups(d.groups || [])
        }
      })
      .catch(() => setGroups([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [])

  // Booking search for manual override
  useEffect(() => {
    if (!overrideForKey || searchQuery.trim().length < 2) {
      setSearchHits([])
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/bookings/list')
        const data = await res.json()
        const all: BookingHit[] = Array.isArray(data.bookings) ? data.bookings : []
        const q = searchQuery.toLowerCase()
        const filtered = all.filter((b) => {
          const inJob = (b.jobName || '').toLowerCase().includes(q)
          const inProd = (b.productionName || '').toLowerCase().includes(q)
          const inCo = (b.company?.name || '').toLowerCase().includes(q)
          const inNum = b.bookingNumber.toLowerCase().includes(q)
          return inJob || inProd || inCo || inNum
        })
        setSearchHits(filtered.slice(0, 8))
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [overrideForKey, searchQuery])

  const visibleGroups = useMemo(() => {
    if (filter === 'ALL') return groups
    return groups.filter((g) => g.match.confidence === filter)
  }, [groups, filter])

  const linkOne = async (group: OrphanGroup, bookingId: string) => {
    setLinking((prev) => new Set(prev).add(group.key))
    try {
      const res = await fetch('/api/dispatch/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planyoCartId: group.planyoCartId,
          // Singletons without a cart fall back to single-reservation link.
          reservationId: group.planyoCartId ? undefined : group.units[0].reservationId,
          bookingId,
        }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setLinked((prev) => new Set(prev).add(group.key))
        setToast(`Linked ${data.count} reservation${data.count === 1 ? '' : 's'}`)
        setTimeout(() => setToast(null), 2500)
        // Drop the group from the list so the queue shrinks live.
        setGroups((prev) => prev.filter((g) => g.key !== group.key))
        setCounts((prev) =>
          prev
            ? {
                ...prev,
                total: prev.total - 1,
                [group.match.confidence.toLowerCase() as 'high' | 'medium' | 'low' | 'none']:
                  prev[group.match.confidence.toLowerCase() as 'high' | 'medium' | 'low' | 'none'] - 1,
              }
            : prev,
        )
        if (overrideForKey === group.key) {
          setOverrideForKey(null)
          setSearchQuery('')
          setSearchHits([])
        }
      } else {
        setToast(data.error || 'Link failed')
        setTimeout(() => setToast(null), 3000)
      }
    } finally {
      setLinking((prev) => {
        const next = new Set(prev)
        next.delete(group.key)
        return next
      })
    }
  }

  const bulkLinkHigh = async () => {
    const high = groups.filter((g) => g.match.confidence === 'HIGH' && g.match.top)
    if (high.length === 0) return
    if (!confirm(`Link ${high.length} HIGH-confidence orphan${high.length === 1 ? '' : 's'} to their suggested bookings?`)) {
      return
    }
    setBulkBusy(true)
    try {
      const items = high.map((g) => ({
        planyoCartId: g.planyoCartId || undefined,
        reservationId: g.planyoCartId ? undefined : g.units[0].reservationId,
        bookingId: g.match.top!.bookingId,
      }))
      const res = await fetch('/api/dispatch/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setToast(`Linked ${data.totalLinked} reservation${data.totalLinked === 1 ? '' : 's'} across ${high.length} job${high.length === 1 ? '' : 's'}`)
        setTimeout(() => setToast(null), 3500)
        reload()
      } else {
        setToast(data.error || 'Bulk link failed')
        setTimeout(() => setToast(null), 3000)
      }
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dispatch · Planyo → Booking</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Link Planyo reservations to native Bookings so the timeline carries CRM contact + portal link.
          </p>
        </div>
        {counts && counts.high > 0 && (
          <button
            onClick={bulkLinkHigh}
            disabled={bulkBusy}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[12px] font-bold transition-colors disabled:opacity-60"
          >
            {bulkBusy ? 'Linking…' : `Auto-link all HIGH (${counts.high})`}
          </button>
        )}
      </div>

      {/* Confidence filter chips */}
      {counts && (
        <div className="flex items-center gap-2 mb-4 flex-wrap text-[11px]">
          {(['ALL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] as const).map((f) => {
            const count = f === 'ALL' ? counts.total : counts[f.toLowerCase() as 'high' | 'medium' | 'low' | 'none']
            const active = filter === f
            return (
              <button
                key={f}
                onClick={() => setFilter(f as Confidence | 'ALL')}
                className={`px-3 py-1.5 rounded-full font-semibold border transition-colors ${
                  active
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                {f === 'ALL' ? 'All' : CONFIDENCE_STYLE[f as Confidence].label}
                <span className="opacity-70 ml-1">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-[13px]">Loading orphans…</div>
      ) : visibleGroups.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-[13px]">
          {groups.length === 0
            ? 'No orphan reservations. Every Planyo row is linked to a Booking.'
            : 'No orphans match the current filter.'}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map((group) => {
            const cfg = CONFIDENCE_STYLE[group.match.confidence]
            const isLinking = linking.has(group.key)
            const isLinked = linked.has(group.key)
            const showOverride = overrideForKey === group.key
            return (
              <div key={group.key} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  {/* Orphan side */}
                  <div className="flex-1 min-w-[260px]">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-1">
                      Planyo orphan
                    </div>
                    <div className="text-[14px] font-bold text-gray-900">
                      {group.planyoCompany || '(no company in Planyo)'}
                    </div>
                    <div className="text-[12px] text-gray-700">
                      {group.planyoJobName || group.units[0]?.category || '—'}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {fmt(group.units[0]?.startTime)} – {fmt(group.units[group.units.length - 1]?.endTime)}
                      {group.planyoAgent && ` · ${group.planyoAgent}`}
                      {' · '}
                      {group.unitCount} unit{group.unitCount === 1 ? '' : 's'}
                    </div>
                    {group.unitCount > 1 && (
                      <div className="mt-2 text-[10px] text-gray-500 leading-relaxed">
                        {group.units.map((u) => u.unitName).join(' · ')}
                      </div>
                    )}
                  </div>

                  {/* Match side */}
                  <div className="flex-1 min-w-[260px]">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400">
                        Suggested booking
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                        {cfg.label}
                      </span>
                    </div>
                    {group.match.top ? (
                      <>
                        <div className="text-[14px] font-bold text-gray-900">{group.match.top.companyName || '—'}</div>
                        <div className="text-[12px] text-gray-700">{group.match.top.jobName || '—'}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          {group.match.top.bookingNumber} · score {group.match.top.score} · {group.match.top.reasons.join(', ')}
                        </div>
                      </>
                    ) : (
                      <div className="text-[12px] text-gray-400">No automatic match — search manually below.</div>
                    )}

                    {group.match.alternates.length > 0 && !showOverride && (
                      <details className="mt-2 text-[11px] text-gray-500">
                        <summary className="cursor-pointer hover:text-gray-700">
                          {group.match.alternates.length} alternate{group.match.alternates.length === 1 ? '' : 's'}
                        </summary>
                        <div className="mt-1.5 space-y-1">
                          {group.match.alternates.map((alt) => (
                            <button
                              key={alt.bookingId}
                              onClick={() => linkOne(group, alt.bookingId)}
                              disabled={isLinking || isLinked}
                              className="block w-full text-left p-2 bg-gray-50 hover:bg-gray-100 rounded text-[11px] transition-colors disabled:opacity-50"
                            >
                              <span className="font-semibold text-gray-900">{alt.companyName}</span>
                              <span className="text-gray-500"> · {alt.jobName} · {alt.bookingNumber}</span>
                              <span className="text-gray-400"> · score {alt.score}</span>
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {group.match.top && !showOverride && (
                    <button
                      onClick={() => linkOne(group, group.match.top!.bookingId)}
                      disabled={isLinking || isLinked}
                      className="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-[11px] font-bold rounded-lg disabled:opacity-50"
                    >
                      {isLinking ? 'Linking…' : isLinked ? '✓ Linked' : `Link to ${group.match.top.bookingNumber}`}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (showOverride) {
                        setOverrideForKey(null)
                        setSearchQuery('')
                        setSearchHits([])
                      } else {
                        setOverrideForKey(group.key)
                        setSearchQuery('')
                        setSearchHits([])
                      }
                    }}
                    disabled={isLinking || isLinked}
                    className="px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-[11px] font-semibold rounded-lg disabled:opacity-50"
                  >
                    {showOverride ? 'Cancel search' : 'Override / search'}
                  </button>
                </div>

                {/* Override search */}
                {showOverride && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <input
                      type="text"
                      autoFocus
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search Bookings by company, job, production, or SR-2026-XXXX…"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-[12px] focus:outline-none focus:border-gray-400"
                    />
                    {searching && <div className="text-[11px] text-gray-400 mt-1">Searching…</div>}
                    {!searching && searchHits.length > 0 && (
                      <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                        {searchHits.map((b) => (
                          <button
                            key={b.id}
                            onClick={() => linkOne(group, b.id)}
                            disabled={isLinking}
                            className="block w-full text-left p-2 bg-gray-50 hover:bg-gray-100 rounded text-[11px] transition-colors disabled:opacity-50"
                          >
                            <span className="font-semibold text-gray-900">{b.company?.name || '—'}</span>
                            <span className="text-gray-500"> · {b.jobName || b.productionName || '—'}</span>
                            <span className="text-gray-400"> · {b.bookingNumber}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!searching && searchQuery.length >= 2 && searchHits.length === 0 && (
                      <div className="text-[11px] text-gray-400 mt-2">No bookings match.</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white text-[12px] font-semibold rounded-xl px-4 py-3 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  )
}
