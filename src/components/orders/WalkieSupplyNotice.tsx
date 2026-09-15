'use client'

/**
 * "Do we have the walkies?" — on the order page, above the lines.
 *
 * Wes, 2026-09-15: the "(Sub)" catalog row is gone and HQ decides when
 * walkies need subbing. This reads that decision for ONE order
 * (GET /api/orders/[id]/walkie-supply) and says it in a sentence:
 *
 *   - short    → the count to sub, the day it bites, and a button that
 *                opens the existing Sub-rent modal on the walkie line with
 *                that count filled in. Recording the sub-rental is what
 *                clears it — subbed radios join the pool on their dates.
 *   - covered, but the quotes out would overrun → one quiet line, no button.
 *   - covered  → one quiet line, so "covered" is a fact someone can see.
 *
 * Internal only. A client never sees whether their radios were subbed.
 */

import { useEffect, useState } from 'react'
import { Radio } from 'lucide-react'
import type { SubRentalLineContext } from '@/components/sub-rentals/SubRentalModal'

interface Supply {
  hasWalkies: boolean
  pool?: number
  peakDay?: string | null
  bookedAtPeak?: number
  subbedAtPeak?: number
  short?: number
  shortIfQuotesLand?: number
  quotedPeakDay?: string | null
  walkieQty?: number
  line?: {
    id: string
    description: string
    quantity: number
    rate: number
    start: string
    end: string
  } | null
}

function fmtDay(d: string | null | undefined): string {
  if (!d) return ''
  return new Date(`${d}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

export function WalkieSupplyNotice({
  orderId,
  refreshKey,
  canSubRent,
  onSubRent,
}: {
  orderId: string
  /** Bump to re-read — after a line edit or a sub-rental is recorded. */
  refreshKey: unknown
  canSubRent: boolean
  onSubRent: (line: SubRentalLineContext) => void
}) {
  const [supply, setSupply] = useState<Supply | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/orders/${orderId}/walkie-supply`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Supply | null) => { if (!cancelled) setSupply(j) })
      .catch(() => { if (!cancelled) setSupply(null) })
    return () => { cancelled = true }
  }, [orderId, refreshKey])

  if (!supply?.hasWalkies) return null

  const pool = supply.pool ?? 0
  const short = supply.short ?? 0
  const booked = supply.bookedAtPeak ?? 0
  const subbed = supply.subbedAtPeak ?? 0
  const line = supply.line ?? null
  const onHand = `${pool} on the books${subbed ? ` + ${subbed} subbed in` : ''}`

  if (short > 0) {
    return (
      <div className="bg-chip-bad-bg border border-lt-hairline rounded-xl p-4 mb-6 flex items-start gap-3">
        <Radio size={20} className="text-chip-bad-fg shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 text-sm text-lt-fg">
          <div className="font-semibold text-chip-bad-fg">
            Sub {short} walkie{short === 1 ? '' : 's'} for this order
          </div>
          <div className="text-xs text-lt-fg2 mt-0.5">
            {fmtDay(supply.peakDay)} needs {booked} Motorola CP200s with this order — we have {onHand}.
            Record the sub-rental on the walkie line and this clears.
          </div>
        </div>
        {canSubRent && line && (
          <button
            type="button"
            onClick={() => onSubRent({
              orderId,
              orderLineItemId: line.id,
              description: line.description,
              quantity: line.quantity,
              suggestedQuantity: Math.min(short, line.quantity),
              rate: line.rate,
              pickupDate: line.start,
              returnDate: line.end,
            })}
            className="shrink-0 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
          >
            Sub-rent {Math.min(short, line.quantity)}…
          </button>
        )}
      </div>
    )
  }

  const quoteRisk = supply.shortIfQuotesLand ?? 0
  return (
    <div className="mb-6 flex items-center gap-2 text-xs text-lt-fg2">
      <Radio size={14} className="text-lt-fg3 shrink-0" aria-hidden />
      <span>
        Walkies covered — {booked} of {pool + subbed} Motorola CP200s booked at the busiest point
        {supply.peakDay ? ` (${fmtDay(supply.peakDay)})` : ''}.
        {quoteRisk > 0 && (
          <span className="ml-1 text-chip-warn-fg">
            If the quotes out all land, {quoteRisk} short on {fmtDay(supply.quotedPeakDay)}.
          </span>
        )}
      </span>
    </div>
  )
}
