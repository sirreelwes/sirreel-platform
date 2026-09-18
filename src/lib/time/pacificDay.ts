/**
 * The Pacific business day, as UTC instants.
 *
 * Lifted out of src/lib/collections/eodReport.ts (which imports prisma) so
 * anything pure — the orders day tally, its tests — can ask "which rows belong
 * to Sep 17?" without dragging a database client along. eodReport re-exports
 * both functions, so every existing importer is unchanged.
 *
 * The business day everywhere in HQ is Pacific (see nextOrderNumber in
 * src/lib/orders.ts).
 */

const PACIFIC = 'America/Los_Angeles'

/** Today's date in Pacific, as `YYYY-MM-DD`. */
export function pacificToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * The UTC instants bounding a Pacific calendar day.
 *
 * Derived from the zone's actual offset on that date rather than a fixed -08:00
 * — eight months of the year Los Angeles is -07:00, and a hardcoded offset
 * would put an hour of every evening's takings in the wrong report twice a year.
 */
export function pacificDayRange(dateISO: string): { start: Date; end: Date } {
  const offsetAt = (utc: Date): number => {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: PACIFIC,
      timeZoneName: 'longOffset',
    })
      .formatToParts(utc)
      .find((p) => p.type === 'timeZoneName')?.value // "GMT-07:00"
    const m = s?.match(/GMT([+-])(\d{2}):(\d{2})/)
    if (!m) return -8 * 60
    const sign = m[1] === '-' ? -1 : 1
    return sign * (Number(m[2]) * 60 + Number(m[3]))
  }
  const naive = new Date(`${dateISO}T00:00:00Z`)
  // Two passes: the offset is looked up using a first approximation, then
  // re-checked at the resulting instant so a DST-transition day lands right.
  const first = new Date(naive.getTime() - offsetAt(naive) * 60000)
  const start = new Date(naive.getTime() - offsetAt(first) * 60000)
  const nextNaive = new Date(naive.getTime() + 86400000)
  const nextFirst = new Date(nextNaive.getTime() - offsetAt(nextNaive) * 60000)
  const end = new Date(nextNaive.getTime() - offsetAt(nextFirst) * 60000)
  return { start, end }
}

/** True for a well-formed `YYYY-MM-DD`. */
export const isYmd = (v: string | null | undefined): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * The UTC half-open window `[start, end)` covering a RANGE of Pacific days,
 * both ends inclusive. A single day is `from === to`.
 */
export function pacificRange(fromYmd: string, toYmd: string): { start: Date; end: Date } {
  const a = pacificDayRange(fromYmd)
  const b = pacificDayRange(toYmd)
  // Tolerate a backwards range rather than returning an empty window that
  // silently reads as "nothing happened that day".
  return a.start <= b.start
    ? { start: a.start, end: b.end }
    : { start: b.start, end: a.end }
}
