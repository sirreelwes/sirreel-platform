/**
 * Suggested CONFIGURATION notes for a catalog row — the ways a client
 * commonly asks for a unit to be set up differently, offered as one click
 * so the request lands in writing instead of in someone's memory.
 *
 * Wes, 2026-09-09, on splitting Passenger Van into 12- and 15-passenger:
 * "make their own category, but create a note under it if for example the
 * client requests: Remove last row of seats."
 *
 * The split answers WHICH VAN. This answers HOW IT IS SET UP — the same
 * 15-passenger van goes out as a 12-seater with a luggage well when a
 * production asks, and that is a note on the booking, not a third
 * category. Splitting again for every seating permutation would give the
 * yard a catalog it cannot hold inventory against.
 *
 * These are SUGGESTIONS, never defaults. Nothing is pre-filled: a note
 * that appears on its own is a promise nobody made. Clicking one appends
 * it to the free-text note the rep can then edit or delete, and anything
 * not listed here is simply typed.
 *
 * Where the note ends up:
 *   - OrderLineItem.notes — prints under the description on the quote, so
 *     the client sees the configuration they asked for on the paperwork.
 *   - BookingItem.notes — rides the reservation to the yard, which is who
 *     actually has to pull the bench.
 *
 * Keyed by CATALOG CODE, not by name: codes are stable, and a category
 * rename must not silently drop the suggestions.
 */

const CONFIG_NOTES: Readonly<Record<string, readonly string[]>> = {
  // Both halves of the 2026-09-09 passenger-van split. A 15-passenger with
  // the rear bench out is the standard "we need the cargo room" ask — it is
  // how Pass 2 has been set up for years, which is exactly why it read as a
  // 12-passenger in Planyo and why one blended category was confusing.
  CAT_PASSENGER_VAN_12: ['Remove last row of seats'],
  CAT_PASSENGER_VAN_15: ['Remove last row of seats'],
  // The retired pre-split code. Kept so a historical line opened for edit
  // still offers the same suggestion rather than looking broken.
  CAT_PASSENGER_VAN: ['Remove last row of seats'],
}

/**
 * Configuration notes to suggest for a catalog code. Empty for anything
 * with no known setup variations — callers render nothing in that case.
 */
export function configNotesFor(code: string | null | undefined): readonly string[] {
  if (!code) return []
  return CONFIG_NOTES[code] ?? []
}

/**
 * Category NAME → code, for the one caller that has a name and no code.
 *
 * The gantt's hold modal takes `categoryName` and nothing else, and
 * threading a code through GanttBoard / AddAssetButton / JobQuickActions
 * for a hint chip is more churn than the hint is worth. Keeping the map
 * here rather than a second copy of the note text means a rename costs a
 * line in this file — and costs only the suggestion, never the note
 * itself, which is free text a rep can always type.
 */
const CODE_BY_CATEGORY_NAME: Readonly<Record<string, string>> = {
  '12-Passenger Van': 'CAT_PASSENGER_VAN_12',
  '15-Passenger Van': 'CAT_PASSENGER_VAN_15',
}

/** Configuration notes to suggest for a category by its display name. */
export function configNotesForCategoryName(name: string | null | undefined): readonly string[] {
  if (!name) return []
  return configNotesFor(CODE_BY_CATEGORY_NAME[name.trim()])
}

/**
 * Append a suggestion to an existing free-text note, idempotently.
 *
 * Idempotent because the chip is a toggle-looking thing in a form a rep
 * may click twice, and "Remove last row of seats. Remove last row of
 * seats." on a client's quote reads as a mistake. Case-insensitive so a
 * hand-typed version of the same sentence isn't duplicated either.
 */
export function appendConfigNote(existing: string | null | undefined, note: string): string {
  const current = (existing ?? '').trim()
  if (!current) return note
  if (current.toLowerCase().includes(note.toLowerCase())) return current
  return `${current}\n${note}`
}
