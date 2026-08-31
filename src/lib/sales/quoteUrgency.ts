/**
 * How much runway is left on a sent quote, measured from the PICKUP
 * date rather than from when we sent it.
 *
 * Wes, 2026-08-31: "I want to see when the Pickup Date was for orders
 * before I decide to nudge. It should color code this list so that it's
 * obvious when we are likely to miss a job because of when the job
 * starts."
 *
 * The Quotes Out list only ever showed how STALE a quote was — "sent 8d
 * ago". That is the wrong clock. A quote sent eight days ago for a job
 * in October is fine; one sent this morning for a job that picks up
 * tomorrow is the emergency. Age tells you how long we have been
 * waiting; the pickup date tells you how long we have LEFT.
 *
 * Measured on the live book the day this shipped, three of the nine open
 * quotes were already past their pickup date and nothing on the row said
 * so — one of them had no Nudge button either, so it read as the calmest
 * row on the list.
 *
 * ── Why the date is not just Order.startDate ───────────────────────
 *
 * 4 of those 9 orders had a null startDate; all 9 had line items with a
 * pickupDate. Keying on the order column alone would have blanked the
 * date on 44% of the list — disproportionately the rows that most need
 * judging. The effective pickup is the order's own start when set, and
 * otherwise the earliest thing actually scheduled to leave the yard.
 */

export type QuoteUrgency = 'past' | 'today' | 'critical' | 'soon' | 'open' | 'unknown'

export interface UrgencyMeta {
  /** Row tint — the at-a-glance band. */
  row: string
  /** The pickup date's own text tone. */
  text: string
  /** Left edge marker, matching the jobs rail's vocabulary. */
  rail: string
}

export const URGENCY_STYLE: Record<QuoteUrgency, UrgencyMeta> = {
  past:     { row: 'bg-red-50',    text: 'text-red-700 font-bold',      rail: 'bg-red-500' },
  today:    { row: 'bg-red-50',    text: 'text-red-700 font-bold',      rail: 'bg-red-500' },
  critical: { row: 'bg-orange-50', text: 'text-orange-700 font-bold',   rail: 'bg-orange-500' },
  soon:     { row: 'bg-amber-50',  text: 'text-amber-700 font-semibold',rail: 'bg-amber-500' },
  open:     { row: '',             text: 'text-gray-500',               rail: 'bg-gray-200' },
  unknown:  { row: '',             text: 'text-gray-400',               rail: 'bg-gray-200' },
}

/**
 * Today, as a calendar day in Pacific — the yard's day, and the same
 * rule order numbers already use (src/lib/orders.ts).
 */
export function todayPacific(now = new Date()): string {
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/**
 * Whole days from today to `iso`, compared as CALENDAR DAYS.
 *
 * Rental dates are stored as UTC-midnight, date-only values, so the day
 * is the first ten characters and nothing else. Parsing one into a
 * `Date` and reading it with local getters shifts it a day backwards
 * anywhere west of Greenwich: the first version of this function put
 * "picked up 1d ago" on a job picking up this morning, and "picks up
 * TODAY" on one leaving tomorrow. Both would have been read as facts.
 */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null
  const day = String(iso).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const a = Date.parse(`${todayPacific(now)}T00:00:00Z`)
  const b = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/**
 * Bands chosen by what a rep can still DO, not by round numbers.
 *
 *   past     — pickup was before today. Nothing to win by waiting.
 *   today    — it leaves today or not at all.
 *   critical — 1–2 days. A yes still has to become a pick and a driver.
 *   soon     — 3–6 days. Inside the week; nudge now.
 *   open     — a week or more of runway.
 *   unknown  — no date anywhere. Shown as unknown, never as "fine":
 *              silence about a missing date reads as reassurance.
 */
export function quoteUrgency(pickupIso: string | null | undefined, now = new Date()): QuoteUrgency {
  const d = daysUntil(pickupIso, now)
  if (d === null) return 'unknown'
  if (d < 0) return 'past'
  if (d === 0) return 'today'
  if (d <= 2) return 'critical'
  if (d <= 6) return 'soon'
  return 'open'
}

/** Short human label for the row: "picks up in 3d", "picked up 5d ago". */
export function pickupLabel(pickupIso: string | null | undefined, now = new Date()): string {
  const d = daysUntil(pickupIso, now)
  if (d === null) return 'no pickup date'
  if (d < 0) return `picked up ${Math.abs(d)}d ago`
  if (d === 0) return 'picks up TODAY'
  if (d === 1) return 'picks up tomorrow'
  return `picks up in ${d}d`
}

/**
 * "Aug 22" — the date itself, so the relative label never has to be
 * trusted on its own. Formatted from the same ten characters daysUntil
 * reads, so the two can never disagree by a day.
 */
export function fmtPickup(pickupIso: string | null | undefined): string | null {
  if (!pickupIso) return null
  const day = String(pickupIso).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

/**
 * Sort rank for the Quotes Out list. Lower sorts first.
 *
 * Wes, 2026-08-31: "sort the quotes out list by pickup urgency."
 *
 * Urgency is NOT the same as chronology. Sorting purely by pickup date
 * puts the most overdue quote on top — and a quote nine days past its
 * pickup cannot be missed, because it already was. On the live book that
 * ordering would have stacked four dead rows above the job picking up
 * TODAY and the one picking up tomorrow, which are the only two anyone
 * can still act on.
 *
 * That mistake has already been made once on this codebase, on the jobs
 * rail: "Urgency-first sounded right and reads wrong on the real book —
 * ~90 Planyo-era rentals nobody ever marked back pin themselves to the
 * top as 'Not returned', burying the work of the week."
 * (JobsListProvider). So the order here is by what a rep can still WIN.
 *
 * `past` sorts last but is not hidden, and keeps its red tint — a quote
 * whose job has already gone still needs someone to chase it or mark it
 * lost. It just does not get to sit on top of the live work.
 */
const BAND_RANK: Record<QuoteUrgency, number> = {
  today: 0,      // leaves today or not at all — the last moment to act
  critical: 1,   // 1–2 days
  soon: 2,       // inside the week
  open: 3,       // a week or more of runway
  unknown: 4,    // no date — worth a look, but nothing to count down
  past: 5,       // already gone; chase or close it, but not from the top
}

/**
 * Comparator for two quotes by pickup urgency.
 *
 * Within a band, whichever is closest to today comes first — so among
 * past quotes, yesterday's outranks last week's, being the one still
 * plausibly salvageable.
 */
export function compareByPickupUrgency(
  a: { pickupDate: string | null },
  b: { pickupDate: string | null },
  now = new Date(),
): number {
  const ra = BAND_RANK[quoteUrgency(a.pickupDate, now)]
  const rb = BAND_RANK[quoteUrgency(b.pickupDate, now)]
  if (ra !== rb) return ra - rb
  const da = daysUntil(a.pickupDate, now)
  const db = daysUntil(b.pickupDate, now)
  if (da === null || db === null) return 0
  return Math.abs(da) - Math.abs(db)
}
