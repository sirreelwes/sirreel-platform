/**
 * Driver hours — the pure math behind a driver's "Log your hours" card.
 *
 * Both driver pages (a partner's driver on a sub-rented unit at
 * /drive/unit/[token], a production's driver on one of our trucks at
 * /drive/[token]) post the same shape: a work date and up to four clock
 * readings — left lot, on set, left set, wrap. This module turns that into a stored `hours` figure
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

export interface PortalStamps {
  /** Left the lot — required; the day starts here. */
  leftLot: string
  /** On set / the production's call time. */
  onSet?: string | null
  /** Left set. */
  leftSet?: string | null
  /** Wrap — vehicle cleaned, dumped, fuelled, parked. Closes the day. */
  wrap?: string | null
}

export type PortalHoursResult =
  | {
      ok: true
      startTime: string
      onSetTime: string | null
      leftSetTime: string | null
      endTime: string | null
      /** wrap − left lot, portal to portal. Null while the day is open. */
      hours: number | null
      overnight: boolean
    }
  | { ok: false; error: string }

/**
 * Portal-to-portal hours from up to four clock readings (Wes 2026-09-05):
 * LEFT LOT → ON SET → LEFT SET → WRAP. Hours are wrap minus left-lot — the
 * whole day the vehicle was out, which is what the partner bills and what
 * we pass through. No break: a driver's meal on a 14-hour day is inside the
 * portal-to-portal span by definition.
 *
 * Stamps are read IN ORDER. A later stamp that reads earlier than the one
 * before it is taken as after midnight (18:00 → 02:00 is eight hours), and
 * the day may cross midnight once. A stamp can be skipped (a driver who
 * forgot to log "left set" still gets a total) but not re-ordered.
 */
export function computePortalHours(input: PortalStamps): PortalHoursResult {
  const labels: Array<[keyof PortalStamps, string]> = [
    ['leftLot', 'Left lot'],
    ['onSet', 'On set'],
    ['leftSet', 'Left set'],
    ['wrap', 'Wrap'],
  ]
  const mins: Array<number | null> = []
  const norm: Array<string | null> = []
  for (const [key, label] of labels) {
    const raw = input[key]
    if (raw === undefined || raw === null || raw === '') {
      if (key === 'leftLot') return { ok: false, error: 'When did you leave the lot?' }
      mins.push(null); norm.push(null); continue
    }
    const m = parseClock(raw)
    if (m === null) return { ok: false, error: `${label} must be a clock time like 06:00.` }
    mins.push(m); norm.push(normalizeClock(raw))
  }

  // Walk the sequence; each present stamp must not precede the last one
  // unless we cross midnight (once).
  let last = mins[0]!
  let offset = 0
  for (let i = 1; i < mins.length; i++) {
    const m = mins[i]
    if (m === null) continue
    let abs = m + offset
    if (abs < last) {
      if (offset === 0) { offset = 24 * 60; abs = m + offset }
      else return { ok: false, error: `${labels[i][1]} can’t be before the stamp above it.` }
    }
    last = abs
  }
  const span = mins[3] === null ? null : last - mins[0]!
  if (span !== null && span <= 0) return { ok: false, error: 'Wrap is the same as left lot — check the times.' }
  if (span !== null && span > 24 * 60) return { ok: false, error: 'That day is longer than 24 hours — check the times.' }

  return {
    ok: true,
    startTime: norm[0]!,
    onSetTime: norm[1],
    leftSetTime: norm[2],
    endTime: norm[3],
    hours: span === null ? null : Math.round((span / 60) * 100) / 100,
    overnight: offset > 0,
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
export function sumHours(entries: Array<{ hours: number | string | { toString(): string } | null }>): number {
  const total = entries.reduce((acc, e) => acc + (e.hours === null ? 0 : Number(e.hours.toString()) || 0), 0)
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
