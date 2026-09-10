/**
 * The arithmetic and the addressing behind "release by asset" — PURE, no
 * database, so it can be tested offline (tests/scheduling/hold-release-plan.test.ts).
 *
 * WHY THIS EXISTS. A BookingItem is a CATEGORY LINE with a quantity:
 * "2× Motorhome" is ONE row holding TWO trucks. Every release surface a
 * human points at a single truck — a Gantt bar, a ticked unit on a job's
 * Release-holds list — was addressing that row, so releasing one truck
 * swapped the sibling's assignment too and the other production's unit
 * fell off the board (Wes 2026-09-10: "when you release one held asset on
 * a job, it releases all sometimes. It needs to be release by asset
 * specific").
 *
 * Two pieces solve it: an ID that can name a PART of a line
 * (`holdRowId`), and the rule for what the line looks like after part of
 * it goes back (`planUnitRelease`).
 */

/**
 * A hold ROW id — what a release list ticks, and what
 * POST /api/jobs/[id]/holds expects back:
 *
 *   <itemId>                   the whole line
 *   <itemId>::asset:<assetId>  exactly that unit
 *   <itemId>::pool             the slots on the line with no unit picked
 *
 * A bare BookingItem id still means "the whole line", so every existing
 * caller keeps working unchanged.
 */
export function holdRowId(bookingItemId: string, part: { assetId: string } | 'pool' | null): string {
  if (part === null) return bookingItemId
  if (part === 'pool') return `${bookingItemId}::pool`
  return `${bookingItemId}::asset:${part.assetId}`
}

export interface ParsedHoldRowId {
  bookingItemId: string
  /** Named unit, or null for a whole-line / pooled row. */
  assetId: string | null
  /** This row is the line's unassigned remainder. */
  pooled: boolean
  /** No suffix at all — the whole line comes down. */
  wholeLine: boolean
}

/** Inverse of `holdRowId`. An unknown suffix reads as the whole line. */
export function parseHoldRowId(rowId: string): ParsedHoldRowId {
  const at = rowId.indexOf('::')
  if (at < 0) return { bookingItemId: rowId, assetId: null, pooled: false, wholeLine: true }
  const bookingItemId = rowId.slice(0, at)
  const suffix = rowId.slice(at + 2)
  if (suffix === 'pool') return { bookingItemId, assetId: null, pooled: true, wholeLine: false }
  if (suffix.startsWith('asset:')) {
    return { bookingItemId, assetId: suffix.slice('asset:'.length), pooled: false, wholeLine: false }
  }
  return { bookingItemId, assetId: null, pooled: false, wholeLine: true }
}

export interface ReleasePlan {
  /** ITEM = the whole line comes down. UNITS = named units only. */
  mode: 'ITEM' | 'UNITS'
  /** Assets whose assignments get swapped. */
  releaseAssetIds: string[]
  /** Asked-for assets this line is not actually holding. */
  unmatchedAssetIds: string[]
  /** Quantity to write in UNITS mode. Meaningless in ITEM mode. */
  newQuantity: number
  /** Status to write in UNITS mode. */
  newStatus: 'REQUESTED' | 'ASSIGNED'
}

/**
 * What a named release does to the line.
 *
 *   · quantity DROPS by what is handed back, or the line keeps holding a
 *     pooled slot for a unit nobody wants — availability counts
 *     `quantity - assignedCount` as live demand, so leaving the quantity
 *     alone (what `unassign` does, deliberately) would free the truck and
 *     keep the category booked.
 *   · status re-derives: still fully covered → ASSIGNED, otherwise
 *     REQUESTED, so a part-covered line re-enters the assign lane.
 *   · nothing left → ITEM, the whole-line release. One truck off a
 *     one-truck line is the same act either way.
 *
 * `assignedAssetIds` is the item's ACTIVE assignments only. Both lists
 * are deduped: a double-click that names the same asset twice must not
 * subtract two from the quantity.
 */
export function planUnitRelease(input: {
  quantity: number
  assignedAssetIds: string[]
  releaseAssetIds: string[]
  pooledSlots?: number
}): ReleasePlan {
  const assigned = new Set(input.assignedAssetIds)
  const asked = Array.from(new Set(input.releaseAssetIds))
  const matched = asked.filter((id) => assigned.has(id))
  const unmatched = asked.filter((id) => !assigned.has(id))
  const pooled = Math.max(0, input.pooledSlots ?? 0)
  const newQuantity = input.quantity - matched.length - pooled

  if (newQuantity <= 0) {
    return {
      mode: 'ITEM',
      releaseAssetIds: matched,
      unmatchedAssetIds: unmatched,
      newQuantity: 0,
      newStatus: 'REQUESTED',
    }
  }
  const remainingAssigned = assigned.size - matched.length
  return {
    mode: 'UNITS',
    releaseAssetIds: matched,
    unmatchedAssetIds: unmatched,
    newQuantity,
    newStatus: remainingAssigned >= newQuantity ? 'ASSIGNED' : 'REQUESTED',
  }
}
