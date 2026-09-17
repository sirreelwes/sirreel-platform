/**
 * When does the client's DOT info sheet appear on their portal, and what is
 * on it — decided fresh on every read (2026-09-17).
 *
 * WHAT CHANGED. Phase 2 stored the sheet as a SNAPSHOT: a rep pressed
 * "Generate & publish" in the unit picker, a PDF landed on
 * `Order.dotSheetPdfUrl`, and it sat there. Two things followed from that.
 * Nobody pressing the button meant no sheet ever, on a job with vehicles
 * assigned and a portal open — the commonest outcome, since the button lives
 * inside a modal you only open to assign units. And once pressed, the PDF
 * never moved again: swap Cargo 35 for another van (which the picker has let
 * you do since 2026-09-17) and the client still downloads a sheet naming
 * Cargo 35. A document with the wrong plate on it is worse than no document
 * at the roadside.
 *
 * So the sheet is DERIVED now. The download routes render from the units
 * assigned RIGHT NOW, which makes staleness structurally impossible rather
 * than something a new assignment path has to remember to call. No write
 * path was touched, no cron, no fingerprint column — there is nothing to keep
 * in sync because nothing is stored on the read path.
 *
 * WHAT STILL GATES IT. "Derived" answers freshness, not whether the client
 * should be looking at it at all. A sheet reading "VIN — Not on file" three
 * times is a page of blanks to hand an officer, and publishing it
 * automatically would put it in front of a client with nobody having looked.
 * So:
 *
 *   - COMPLETE record → publishes by itself. Nothing to check, nothing to
 *     press; the row appears when the trucks are picked.
 *   - INCOMPLETE record → does NOT publish. Fleet gets an action item naming
 *     the unit and the fields, and the rep keeps the existing override in the
 *     unit picker ("Generate & publish anyway"), which is now recorded as a
 *     DECISION (`Order.dotSheetGeneratedAt`) rather than as the document.
 *
 * That override is why `publishedAt` is still read here. Once a human has
 * said "send it anyway", the row stays up and the download keeps refreshing
 * to current units — they accepted the gaps, not that particular PDF.
 */

/** What a unit is missing, as gatherDotUnits reports it. */
export interface DotUnitGap {
  unitName: string
  missing: string[]
}

/**
 * What a unit still owes before its DOT page is a usable document. THE one
 * definition — `gatherDotUnits` (rendering the sheet) and
 * `dotSheetStatesForOrders` (the action item) both read it, so the desk can
 * never be chased for a field that would not actually have unblocked the
 * client, or told nothing is missing while the sheet prints a blank.
 *
 * Model is NOT required: plenty of units are a make and a year with no model
 * on the registration, and a page is not less useful for it.
 */
export function missingDotFields(unit: {
  vin?: string | null
  licensePlate?: string | null
  year?: number | null
  make?: string | null
  hasBitInspection: boolean
}): string[] {
  const missing: string[] = []
  if (!unit.vin) missing.push('VIN')
  if (!unit.licensePlate) missing.push('license plate')
  if (!unit.year) missing.push('year')
  if (!unit.make) missing.push('make')
  if (!unit.hasBitInspection) missing.push('BIT inspection')
  return missing
}

export type DotSheetReason =
  /** No vehicles assigned to this order yet — nothing to describe. */
  | 'no-units'
  /** Every assigned unit has its DOT record; published automatically. */
  | 'complete'
  /** Gaps remain, but a rep chose to send it anyway. */
  | 'published-with-gaps'
  /** Gaps remain and nobody has overridden — withheld. */
  | 'incomplete'

export interface DotSheetState {
  /** May the client see and download it? */
  available: boolean
  reason: DotSheetReason
  /** True when it is up WITHOUT anyone having pressed anything. */
  automatic: boolean
  unitCount: number
  /** Units still missing something — empty when reason is 'complete'. */
  gaps: DotUnitGap[]
}

/**
 * The one rule. Read by the portal payload (does the row appear?), the portal
 * download proxy (may this stream?), the staff readiness check, and the
 * action item — so a client can never be offered a sheet the desk was told
 * was withheld, and vice versa.
 */
export function dotSheetState(args: {
  unitCount: number
  gaps: readonly DotUnitGap[]
  /** Order.dotSheetGeneratedAt — a human pressed publish at some point. */
  publishedAt: Date | string | null | undefined
}): DotSheetState {
  const gaps = args.gaps.filter((g) => g.missing.length > 0).map((g) => ({ unitName: g.unitName, missing: [...g.missing] }))

  if (args.unitCount <= 0) {
    // No units is never "published", whatever a stale timestamp says: the
    // sheet would render zero pages. An order whose trucks were all released
    // must not keep serving the PDF it had when it had them.
    return { available: false, reason: 'no-units', automatic: false, unitCount: 0, gaps: [] }
  }
  if (gaps.length === 0) {
    return { available: true, reason: 'complete', automatic: true, unitCount: args.unitCount, gaps: [] }
  }
  if (args.publishedAt) {
    return { available: true, reason: 'published-with-gaps', automatic: false, unitCount: args.unitCount, gaps }
  }
  return { available: false, reason: 'incomplete', automatic: false, unitCount: args.unitCount, gaps }
}

/**
 * What the client's portal row says when the sheet is not there. Never names
 * a VIN or a plate as missing to the CLIENT — that is our record-keeping, not
 * their problem, and "we are missing your truck's VIN" invites a question
 * they cannot answer. The desk gets the specifics through the action item.
 */
export function clientWaitingNote(state: DotSheetState): string | null {
  if (state.available) return null
  return state.reason === 'no-units'
    ? 'Year, make, VIN, plate & latest BIT for your vehicles — for the cab, once your trucks are picked.'
    : 'Being prepared — we are completing the record for your vehicles. Ask your rep if you need it today.'
}

/**
 * The status word on the client's paperwork row. Kept beside the note so the
 * two cannot disagree — "Being prepared" over "once your trucks are picked"
 * is the pair that says nothing has happened AND that we are mid-way through
 * it, which cannot both be true.
 */
export function clientStatusLabel(state: DotSheetState): string {
  if (state.available) return 'Available'
  return state.reason === 'no-units' ? 'When vehicles are assigned' : 'Being prepared'
}

/** One line for the desk, naming what is actually holding it back. */
export function deskBlockerSentence(state: DotSheetState): string | null {
  if (state.reason !== 'incomplete') return null
  const first = state.gaps
    .slice(0, 3)
    .map((g) => `${g.unitName} (${g.missing.join(', ')})`)
    .join(' · ')
  const more = state.gaps.length > 3 ? ` · +${state.gaps.length - 3} more` : ''
  return `Withheld from the client portal until the record is complete: ${first}${more}`
}
