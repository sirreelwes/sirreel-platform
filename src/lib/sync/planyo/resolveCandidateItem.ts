/**
 * Map a Planyo RELEASE_CANDIDATE back to the BookingItem holding the unit.
 *
 * Shared by the review screen and the auto-release cron so the two can
 * never disagree about which line a candidate refers to — the screen
 * showing one truck while the cron frees another is the worst possible
 * failure here.
 *
 * The journal stores the RAW Planyo unit string ("8 (Mid Roof) A",
 * "Super Cargo #43"), which never equals an Asset.unitName — matching on
 * it directly resolved 0 of 42 real candidates. Running it through
 * normalizePlanyoUnitName, the same normalizer the importer used to
 * create the pair, resolved 39; single-line bookings cover the rest.
 *
 * `matchedBy` is returned so callers can treat the weaker inference
 * differently: the screen labels it, and auto-release refuses it.
 */

import { normalizePlanyoUnitName } from '@/lib/scheduling/planyoNameNormalizer'

export interface CandidateReservation {
  unitName: string
  category: string | null
  booking: {
    items: Array<{
      id: string
      status: string
      category: { name: string } | null
      assignments: Array<{ asset: { unitName: string } | null }>
    }>
  } | null
}

export interface ResolvedCandidate {
  bookingItemId: string | null
  itemStatus: string | null
  matchedBy: 'unit' | 'single-item' | null
}

export function resolveCandidateItem(r: CandidateReservation): ResolvedCandidate {
  const items = r.booking?.items ?? []
  if (items.length === 0) return { bookingItemId: null, itemStatus: null, matchedBy: null }

  const match = items.find((it) => {
    const cat = it.category?.name ?? r.category ?? ''
    const normalized = normalizePlanyoUnitName(r.unitName, cat).normalized
    return it.assignments.some(
      (a) => a.asset?.unitName === normalized || a.asset?.unitName === r.unitName,
    )
  })
  if (match) return { bookingItemId: match.id, itemStatus: match.status, matchedBy: 'unit' }

  // Unambiguous only because there is exactly one line on the booking —
  // a weaker claim than a unit match, and flagged as such.
  if (items.length === 1) {
    return { bookingItemId: items[0].id, itemStatus: items[0].status, matchedBy: 'single-item' }
  }
  return { bookingItemId: null, itemStatus: null, matchedBy: null }
}
