'use client'

/**
 * The bulk action bar — appears once anything is selected.
 *
 * Two things it must never do, both learned from bulk UIs that get
 * people in trouble:
 *
 * 1. Be vague about what "all" means. The table renders at most 100
 *    rows, so "Select all" on the header checkbox selects THOSE rows and
 *    says so. Selecting the whole filtered set is a separate, explicit
 *    action that names its real number ("Select all 1,284 in this
 *    segment") and fetches the ids from the server. A rep who thinks
 *    they logged 1,284 touches and actually logged 100 has a corrupted
 *    record and no way to notice.
 *
 * 2. Sit still while it works. Selecting a whole segment is a network
 *    round trip; the button says so rather than looking dead.
 *
 * Export is deliberately absent. Exporting the client book requires
 * Wes's approval through /api/exports/requests, and that flow is
 * Company-shaped today — wiring a People export into the bulk bar would
 * either duplicate it or route around the approval, and neither belongs
 * in this phase.
 */

export function BulkSelectionBar({
  selectedCount,
  pageCount,
  segmentTotal,
  allInSegmentSelected,
  selectingAll,
  onSelectAllInSegment,
  onClear,
  onLogOutreach,
}: {
  selectedCount: number
  /** How many rows are actually rendered right now. */
  pageCount: number
  /** How many match the active filters in total, per the server. */
  segmentTotal: number | null
  allInSegmentSelected: boolean
  selectingAll: boolean
  onSelectAllInSegment: () => void
  onClear: () => void
  onLogOutreach: () => void
}) {
  if (selectedCount === 0) return null

  // Offer whole-segment selection only when it would actually add
  // anything — i.e. the filtered set is genuinely bigger than the page.
  const canSelectWholeSegment =
    !allInSegmentSelected &&
    segmentTotal !== null &&
    segmentTotal > pageCount &&
    selectedCount >= pageCount

  return (
    <div className="sticky bottom-4 z-30 mt-3">
      <div className="mx-auto max-w-3xl bg-lt-fg text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold tabular-nums">
          {selectedCount.toLocaleString()} selected
        </span>

        {canSelectWholeSegment && (
          <button
            type="button"
            onClick={onSelectAllInSegment}
            disabled={selectingAll}
            className="text-xs underline underline-offset-2 text-white/80 hover:text-white disabled:opacity-60"
          >
            {selectingAll
              ? 'Selecting…'
              : `Select all ${segmentTotal.toLocaleString()} in this segment`}
          </button>
        )}

        {allInSegmentSelected && segmentTotal !== null && (
          <span className="text-xs text-white/70">
            Every contact matching the current filters
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="text-xs px-3 py-1.5 rounded-lg border border-white/25 text-white/85 hover:bg-white/10"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onLogOutreach}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
          >
            Log outreach
          </button>
        </div>
      </div>
    </div>
  )
}
