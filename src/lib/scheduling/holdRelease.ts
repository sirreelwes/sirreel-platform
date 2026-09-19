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

/**
 * A ROW release plan — the same arithmetic addressed at ASSIGNMENT ROWS
 * instead of assets.
 *
 * WHY AN ASSET ID IS NOT ENOUGH (Wes 2026-09-19). An asset id is not a
 * unique key on a BookingItem: one van can sit on one hold TWICE, because
 * an order routinely carries two date blocks of the same class
 * (assignWindow.ts is built around exactly that). `planUnitRelease` dedupes
 * its lists — right for a double-click that names one truck twice, wrong
 * for two genuine trips — and the write behind it is an `updateMany` on
 * `assetId IN (…)` with no date and no line filter. So releasing ONE line's
 * Sprinter 2 swapped the SIBLING line's Sprinter 2 as well, while the
 * quantity came down by one. The hold was left reading "0 of 1 assigned"
 * with two SWAPPED rows on it and a live line still quoting the van.
 *
 * A line knows exactly which rows are its own (`liveUnitsForLine` returns
 * the assignment id), so it releases those rows and nothing else.
 *
 * THE TRAP, and why `newQuantity` takes a floor: degrading to the
 * whole-item release when the quantity hits zero is right for an asset
 * release and catastrophic here. The quantity is the PEAK
 * (`holdOnQuoteSend` sets it), so a van on the hold twice for two
 * non-overlapping trips is quantity 1 with TWO rows — and releasing one
 * trip would take the quantity to 0, fall into the whole-item branch, and
 * swap the trip that was staying. **The line never holds fewer units than
 * it has trucks bound**, so the quantity floors at the rows that survive
 * and ITEM mode is reachable only when nothing is left bound.
 */
export interface RowReleasePlan {
  mode: 'ITEM' | 'UNITS'
  /** Assignment rows whose status gets swapped. */
  releaseAssignmentIds: string[]
  /** Asked-for rows this line is not actually holding. */
  unmatchedAssignmentIds: string[]
  newQuantity: number
  newStatus: 'REQUESTED' | 'ASSIGNED'
}

export function planRowRelease(input: {
  quantity: number
  activeAssignmentIds: string[]
  releaseAssignmentIds: string[]
  pooledSlots?: number
}): RowReleasePlan {
  const active = new Set(input.activeAssignmentIds)
  const asked = Array.from(new Set(input.releaseAssignmentIds))
  const matched = asked.filter((id) => active.has(id))
  const unmatched = asked.filter((id) => !active.has(id))
  const pooled = Math.max(0, input.pooledSlots ?? 0)
  const remaining = active.size - matched.length
  // The floor: never fewer units than trucks still bound. Without it a
  // peak-quantity hold with two trips of one van releases the trip that
  // was meant to stay.
  const newQuantity = Math.max(input.quantity - matched.length - pooled, remaining)

  if (newQuantity <= 0) {
    return {
      mode: 'ITEM',
      releaseAssignmentIds: matched,
      unmatchedAssignmentIds: unmatched,
      newQuantity: 0,
      newStatus: 'REQUESTED',
    }
  }
  return {
    mode: 'UNITS',
    releaseAssignmentIds: matched,
    unmatchedAssignmentIds: unmatched,
    newQuantity,
    newStatus: remaining >= newQuantity ? 'ASSIGNED' : 'REQUESTED',
  }
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
