/**
 * What a client may ask for when they want to move their dates — the pure
 * half, shared by the portal form, the POST route and the test.
 *
 * Nothing here writes, and nothing here decides whether the change is
 * POSSIBLE. Availability, pricing and unit conflicts are the cascade that
 * "Change dates…" shows a rep (PushDatesModal → /dates/preview), and a
 * client must not be told "that date is free" by a form — the trucks move
 * around them between the ask and the answer. So this validates only the
 * shape of the ask: that it says something, that it says something
 * coherent, and that it is not in the past.
 */

/** A date-only string as the form and the DATE columns both hold it. */
export type DayString = string // YYYY-MM-DD

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Parse YYYY-MM-DD as a UTC midnight Date, or null. Never local time —
 *  `new Date('2026-09-18')` is already UTC, but `new Date(y, m, d)` is not,
 *  and a Los Angeles client picking the 18th must not store the 17th. */
export function parseDay(v: unknown): Date | null {
  if (typeof v !== 'string' || !DAY.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isFinite(d.getTime()) ? d : null
}

/** A Date (or ISO string) as the YYYY-MM-DD the form uses, read in UTC. */
export function toDay(v: Date | string | null | undefined): DayString | null {
  if (!v) return null
  const d = typeof v === 'string' ? new Date(v) : v
  if (!Number.isFinite(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

export interface DateChangeAsk {
  /** Null = "leave this one alone". */
  start: DayString | null
  end: DayString | null
  note: string
}

export interface CurrentWindow {
  start: DayString | null
  end: DayString | null
}

export type AskProblem =
  | { code: 'empty'; message: string }
  | { code: 'unchanged'; message: string }
  | { code: 'backwards'; message: string }
  | { code: 'past'; message: string }
  | { code: 'note-too-long'; message: string }

export const NOTE_MAX = 2000

/**
 * Validate the ask. `today` is passed in (never read from the clock here)
 * so the test can pin it and the route can use Pacific — a client in Los
 * Angeles asking for "tomorrow" at 9pm must not be told it is in the past
 * because the server has already rolled over to UTC tomorrow.
 */
export function checkAsk(
  ask: DateChangeAsk,
  current: CurrentWindow,
  today: DayString,
): AskProblem | null {
  const note = ask.note.trim()
  if (note.length > NOTE_MAX) {
    return { code: 'note-too-long', message: `Please keep it under ${NOTE_MAX} characters.` }
  }
  // A note on its own is a legitimate ask — "we may need to push a day,
  // still waiting on the location" is worth a rep's attention and carries
  // no date at all. What is not an ask is an empty form.
  if (!ask.start && !ask.end && !note) {
    return { code: 'empty', message: 'Tell us the new date, or what you need, and we will take it from there.' }
  }
  const start = ask.start ?? current.start
  const end = ask.end ?? current.end
  if (start && end && start > end) {
    return { code: 'backwards', message: 'The return date cannot be before the pickup date.' }
  }
  for (const d of [ask.start, ask.end]) {
    if (d && d < today) {
      return { code: 'past', message: 'That date has already passed — please pick a date from today onwards.' }
    }
  }
  // Both dates match what the order already says, and nothing was written.
  if (!note && ask.start === current.start && ask.end === current.end) {
    return { code: 'unchanged', message: 'Those are the dates we already have. Change one, or tell us what you need.' }
  }
  return null
}

/**
 * Only the dates that actually MOVE are stored. A form posts both boxes
 * whatever the client touched, so without this every request would look
 * like it moved the return as well and a rep re-applying it would widen
 * the window by hand for no reason.
 */
export function movedOnly(ask: DateChangeAsk, current: CurrentWindow): {
  start: DayString | null
  end: DayString | null
} {
  return {
    start: ask.start && ask.start !== current.start ? ask.start : null,
    end: ask.end && ask.end !== current.end ? ask.end : null,
  }
}

/** One line for the desk: "pickup Sep 17 → Sep 16" / "return … " / both. */
export function describeAsk(args: {
  currentStart: DayString | null
  currentEnd: DayString | null
  requestedStart: DayString | null
  requestedEnd: DayString | null
}): string {
  const parts: string[] = []
  if (args.requestedStart) parts.push(`pickup ${pretty(args.currentStart)} → ${pretty(args.requestedStart)}`)
  if (args.requestedEnd) parts.push(`return ${pretty(args.currentEnd)} → ${pretty(args.requestedEnd)}`)
  if (!parts.length) return 'no new date named'
  return parts.join(', ')
}

/** "Sep 17" / "Sep 17, 2027" when it is not this year. Read in UTC. */
export function pretty(day: DayString | null, todayYear?: number): string {
  if (!day) return '—'
  const d = new Date(`${day}T00:00:00.000Z`)
  if (!Number.isFinite(d.getTime())) return '—'
  const year = d.getUTCFullYear()
  const base = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return todayYear !== undefined && year !== todayYear
    ? `${base}, ${year}`
    : base
}

/**
 * Has the order moved since they asked? A rep reading a three-day-old
 * request needs to know the window is no longer the one the client was
 * looking at — otherwise "apply the pickup they asked for" silently undoes
 * whatever changed in between.
 */
export function windowDrifted(
  asked: CurrentWindow,
  now: CurrentWindow,
): boolean {
  return asked.start !== now.start || asked.end !== now.end
}

/** Already what they asked for — the request answered itself. */
export function alreadySatisfied(
  requested: { start: DayString | null; end: DayString | null },
  now: CurrentWindow,
): boolean {
  if (!requested.start && !requested.end) return false
  if (requested.start && requested.start !== now.start) return false
  if (requested.end && requested.end !== now.end) return false
  return true
}
