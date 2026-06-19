/**
 * Canonical Planyo↔HQ date converter.
 *
 * Planyo's API returns local-time strings ("YYYY-MM-DD HH:MM:SS") for the
 * site's configured timezone — for SirReel that's America/Los_Angeles. The
 * May 2026 backfill parsed those strings as UTC, producing UTC timestamps
 * shifted by the LA offset for some rows. The converter below works in LA
 * calendar dates so it tolerates both correctly-stored and bug-shifted
 * historical rows.
 *
 * All comparisons of HQ vs Planyo go through `planyoLocalTimeToLADate` and
 * `hqStoredToLADate`. All writes go through `laDateStartToUTC` /
 * `laDateEndToUTC`, which use Intl to discover the active offset (PDT vs
 * PST) — no hardcoded ±7 / ±8.
 */

const LA_TZ = 'America/Los_Angeles'

const laDateOnlyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: LA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Planyo's local-time string → LA calendar date (YYYY-MM-DD). */
export function planyoLocalTimeToLADate(s: string | null | undefined): string | null {
  const m = (s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? m[0] : null
}

/** Any UTC Date → LA calendar date (YYYY-MM-DD). LA-render only — DO NOT
 *  use this on Reservation rows directly; use `readHQDateLA` instead so
 *  Convention-B (UTC-midnight) rows are read correctly. Kept exposed for
 *  callers that know the timestamp is Convention A (e.g. the converter
 *  test suite). */
export function hqStoredToLADate(d: Date): string {
  return laDateOnlyFmt.format(d)
}

/**
 * Convention-aware reader for an HQ Reservation timestamp. Discriminates
 * between the two storage conventions present in the table:
 *
 *   - Convention A (LA-canonical UTC): startTime stored at 07:00 PDT
 *     (08:00 PST), endTime at 06:59 / 07:59 UTC. The actual LA moment
 *     is encoded; LA-rendering yields the LA date.
 *   - Convention B (LA-string-as-UTC): the May 2026 backfill bug;
 *     startTime at 00:00 UTC, endTime at 23:59 UTC. The LA date is the
 *     UTC-component date directly.
 *
 * Discriminator: a UTC time-of-day of exactly 00:00:00 means Convention
 * B (start side); any other time-of-day means Convention A. For
 * Convention-B end side (23:59 UTC) LA-rendering coincidentally returns
 * the correct LA date too (LA 16:59 same day), so the same branch
 * handles it. The result is a single deterministic LA date per row, no
 * "either reader" guessing — every real ±1-day drift is caught.
 *
 * Use on Booking `@db.Date` columns as well: those are always stored as
 * UTC midnight, so they hit the Convention-B branch and read correctly.
 */
export function readHQDateLA(d: Date): string {
  if (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  ) {
    return d.toISOString().slice(0, 10)
  }
  return laDateOnlyFmt.format(d)
}

/**
 * Return the LA UTC-offset string ("-07:00" or "-08:00") active on the
 * calendar date `ymd`. Uses Intl, no DST table.
 */
function laOffsetAt(ymd: string): string {
  const probe = new Date(`${ymd}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LA_TZ,
    timeZoneName: 'longOffset',
  }).formatToParts(probe)
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-08:00'
  return tz.replace(/^GMT/, '') || '-08:00'
}

/** LA midnight on `ymd` → UTC Date. */
export function laDateStartToUTC(ymd: string): Date {
  return new Date(`${ymd}T00:00:00${laOffsetAt(ymd)}`)
}

/** LA 23:59 on `ymd` → UTC Date. (Matches Planyo's end-of-day convention.) */
export function laDateEndToUTC(ymd: string): Date {
  return new Date(`${ymd}T23:59:00${laOffsetAt(ymd)}`)
}

/**
 * UTC-midnight Date for an LA calendar date. Use for `@db.Date` columns —
 * Prisma's @db.Date storage truncates to UTC date, so the only encoding
 * that round-trips intact is `new Date(`${ymd}T00:00:00Z`)`. The HQ
 * convention is: the UTC-sliced date IS the operational calendar date.
 * Do not use the LA timezone helpers above for @db.Date columns or the
 * stored date will land 1 calendar day off after round-trip.
 */
export function laDateToDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`)
}
