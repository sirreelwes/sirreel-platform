// How long a unit is N/A. Prisma-free and client-safe: the gantt prompt and
// the maintenance route both compute the same end date from the same rule.
//
// Sales/fleet, 2026-09-15: "sometimes they know it's only going to be a day or
// two." Until then every N/A record was open-ended, so a truck out for a
// one-day fix stayed unbookable until someone remembered to Clear it.
//
// Days are CALENDAR days, INCLUSIVE (the house rule — Sep 14→16 is 3): out
// "1 day" starting today means endDate = today, bookable again tomorrow. The
// record's endDate is the LAST day out, which is exactly what
// outOfServiceByAsset and the timeline already overlap-test against.

export const NA_DURATION_PRESETS = [
  { days: 1, label: '1 day' },
  { days: 2, label: '2 days' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
] as const

/** Longest a dated N/A may run. Past this it is "until cleared" in disguise. */
export const NA_MAX_DAYS = 365

const YMD = /^\d{4}-\d{2}-\d{2}$/

function toUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = toUtc(ymd)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Last day out for an N-day (inclusive) N/A starting on `startYmd`. */
export function naEndForDays(startYmd: string, days: number): string {
  return addDaysYmd(startYmd, Math.max(1, Math.floor(days)) - 1)
}

/**
 * Validate a requested last-day-out. `undefined`/`null`/'' → null, meaning
 * open-ended (until fleet clears it). Anything else must be a real
 * YYYY-MM-DD on or after `startYmd` and within NA_MAX_DAYS of it.
 */
export function parseNaEndDate(
  raw: unknown,
  startYmd: string,
): { ok: true; endYmd: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, endYmd: null }
  if (typeof raw !== 'string' || !YMD.test(raw) || toUtc(raw).toISOString().slice(0, 10) !== raw) {
    return { ok: false, error: 'endDate must be YYYY-MM-DD' }
  }
  if (raw < startYmd) return { ok: false, error: 'the return date is before today' }
  if (raw > addDaysYmd(startYmd, NA_MAX_DAYS)) {
    return { ok: false, error: `a dated N/A can run at most ${NA_MAX_DAYS} days — use "until cleared"` }
  }
  return { ok: true, endYmd: raw }
}

/** YYYY-MM-DD of a @db.Date value (stored as UTC midnight) or a ymd string. */
export function ymdOf(d: Date | string | null | undefined): string | null {
  if (!d) return null
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

/**
 * Is this N/A still in effect on `todayYmd`? Open-ended always is; a dated
 * one is until its last day has passed. Status alone can't answer it — a
 * dated record keeps SCHEDULED/IN_PROGRESS after its end, and nothing needs
 * to close it: availability already stops counting it the next day.
 */
export function naInEffect(endDate: Date | string | null | undefined, todayYmd: string): boolean {
  const end = ymdOf(endDate)
  return end === null || end >= todayYmd
}

/** "Wed Sep 16" — for a YYYY-MM-DD, no timezone drift. */
export function naDayLabel(ymd: string): string {
  return toUtc(ymd).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** One line saying when the unit is back, for the prompt and tooltips. */
export function naReturnLine(endYmd: string | null): string {
  if (!endYmd) return 'Stays N/A until fleet clears it'
  return `Out through ${naDayLabel(endYmd)} — bookable again ${naDayLabel(addDaysYmd(endYmd, 1))}`
}
