/**
 * Date helpers for the white-label HQ. Bookings are @db.Date columns —
 * calendar days with no clock — so everything here works in YYYY-MM-DD
 * strings and formats in UTC (see project rule: formatting a @db.Date in
 * local time prints the day before).
 */

export function ymd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

/** A YYYY-MM-DD string → the Date Prisma stores in a @db.Date column. */
export function fromYmd(s: string): Date {
  return new Date(`${s}T00:00:00Z`)
}

export function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromYmd(s).getTime())
}

export function addDays(s: string, n: number): string {
  const d = fromYmd(s)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Inclusive day count between two YYYY-MM-DD strings. */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / 86_400_000) + 1
}

/** Today's calendar day where the fleet lives (Los Angeles). */
export function todayPacific(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function fmtDay(s: string | null, opts: { weekday?: boolean; year?: boolean } = {}): string | null {
  if (!s) return null
  const d = fromYmd(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', {
    ...(opts.weekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    ...(opts.year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
}

export function fmtRange(start: string | null, end: string | null): string {
  const a = fmtDay(start, { weekday: true })
  const b = fmtDay(end, { weekday: true })
  if (a && b) return start === end ? a : `${a} – ${b}`
  return a ?? b ?? 'dates to be confirmed'
}

/** "2026-09" → every day of that month as YYYY-MM-DD. */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

export function isMonth(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function fmtMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** Do two inclusive day ranges overlap? */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd
}
