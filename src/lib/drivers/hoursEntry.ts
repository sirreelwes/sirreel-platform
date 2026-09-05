/**
 * Driver hours — the pure math behind a driver's "Log your hours" card.
 *
 * Both driver pages (a partner's driver on a sub-rented unit at
 * /drive/unit/[token], a production's driver on one of our trucks at
 * /drive/[token]) post the same shape: a work date, a start and end clock
 * reading, and a break. This module turns that into a stored `hours` figure
 * and decides what is and isn't a valid entry. No Prisma, no Date.now() —
 * every input is passed in so `npm run test:conduit` can assert exact
 * numbers.
 *
 * Why the hours are stored rather than derived on read: a partner bills us
 * against these, and a driver who saw "10.5 hours" on their page must keep
 * seeing 10.5 if the rounding rule is ever revisited. The clock readings
 * stay alongside so the figure can always be re-checked.
 */

/** "HH:MM" (24h) → minutes since midnight, or null when it isn't a clock. */
export function parseClock(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Canonical "HH:MM" for storage, so "6:00" and "06:00" are one value. */
export function normalizeClock(value: string): string | null {
  const mins = parseClock(value)
  if (mins === null) return null
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

export interface HoursInput {
  startTime: string
  endTime: string
  breakMinutes?: number | null
}

export type HoursResult =
  | { ok: true; hours: number; startTime: string; endTime: string; breakMinutes: number; overnight: boolean }
  | { ok: false; error: string }

/**
 * Hours worked for one day.
 *
 * An end time at or before the start is read as the NEXT day — a driver
 * who reports at 18:00 and wraps at 02:00 worked eight hours, not minus
 * sixteen. That is the common night-shoot case and the reason a same-clock
 * pair (06:00 → 06:00) reads as 24 hours rather than zero: nobody logs a
 * zero-hour day, and a 24-hour one is at least a figure a human will
 * question.
 *
 * The break comes off the span. Not the payroll module's "no meal under
 * six hours" rule — that decides what SirReel PAYS its crew; this records
 * what a driver SAYS they worked, and the break is whatever they enter.
 */
export function computeHours(input: HoursInput): HoursResult {
  const start = parseClock(input.startTime)
  const end = parseClock(input.endTime)
  if (start === null) return { ok: false, error: 'Start time must be a clock time like 06:00.' }
  if (end === null) return { ok: false, error: 'End time must be a clock time like 18:30.' }
  const brk = Math.max(0, Math.round(Number(input.breakMinutes ?? 0) || 0))
  if (brk > 8 * 60) return { ok: false, error: 'Break can’t be longer than eight hours.' }

  const overnight = end <= start
  const span = (overnight ? end + 24 * 60 : end) - start
  const worked = span - brk
  if (worked <= 0) return { ok: false, error: 'The break is as long as the whole day — check the times.' }

  return {
    ok: true,
    hours: Math.round((worked / 60) * 100) / 100,
    startTime: normalizeClock(input.startTime)!,
    endTime: normalizeClock(input.endTime)!,
    breakMinutes: brk,
    overnight,
  }
}

/** "YYYY-MM-DD" and a real calendar date, else null. */
export function parseWorkDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? d.toISOString().slice(0, 10) : null
}

/**
 * Is a work date one a driver on this rental may plausibly log?
 *
 * The rental window, padded by a day each side — a driver delivers the
 * evening before a shoot and collects the morning after, and refusing
 * those days teaches them the form is wrong. Anything further out is a
 * typo (or a different job) and is refused so the partner's invoice check
 * isn't polluted. Open-ended when the rental has no dates at all.
 */
export function workDateInWindow(
  workDate: string,
  window: { startDate: string | null; endDate: string | null },
  padDays = 1,
): boolean {
  const d = Date.parse(`${workDate}T00:00:00.000Z`)
  const pad = padDays * 86_400_000
  if (window.startDate && d < Date.parse(`${window.startDate}T00:00:00.000Z`) - pad) return false
  if (window.endDate && d > Date.parse(`${window.endDate}T00:00:00.000Z`) + pad) return false
  return true
}

/** Total across entries; tolerant of Prisma Decimals arriving as strings. */
export function sumHours(entries: Array<{ hours: number | string | { toString(): string } }>): number {
  const total = entries.reduce((acc, e) => acc + (Number(e.hours.toString()) || 0), 0)
  return Math.round(total * 100) / 100
}

/**
 * The driver confirmed a PREVIOUS version of the plan.
 *
 * True when the location or call time changed after they pressed
 * "I have it" — their yes no longer covers what's on the page. Never
 * true when they haven't confirmed at all (that is "awaiting", a
 * different state with different copy) or when nothing has been set yet.
 */
export function isAckStale(
  ackedAt: Date | string | null | undefined,
  logisticsUpdatedAt: Date | string | null | undefined,
): boolean {
  if (!ackedAt || !logisticsUpdatedAt) return false
  return new Date(ackedAt).getTime() < new Date(logisticsUpdatedAt).getTime()
}

/**
 * Should the page be nagging for hours right now? From the first rental
 * day (a delivery driver works on day one) until a fortnight after the
 * last — after that the partner has invoiced and the prompt is noise.
 */
export function hoursPromptOpen(
  window: { startDate: string | null; endDate: string | null },
  today: string,
): boolean {
  if (!window.startDate) return false
  const t = Date.parse(`${today}T00:00:00.000Z`)
  if (t < Date.parse(`${window.startDate}T00:00:00.000Z`)) return false
  if (window.endDate && t > Date.parse(`${window.endDate}T00:00:00.000Z`) + 14 * 86_400_000) return false
  return true
}
