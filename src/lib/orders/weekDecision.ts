/**
 * THE BILLING WEEK, MADE A DECISION SOMEONE HAS TO MAKE.
 *
 * Wes 2026-09-11: "If a 3d 2d or 1d week isn't selected, it goes out full
 * rate. I feel like we should prompt agents to select rather than risk
 * losing work because our quote comes in so much higher."
 *
 * ── What actually happens today ────────────────────────────────────
 *
 * A dated line gets its billable days from the DEPARTMENT'S STANDARD
 * week (`suggestDaysIfReady` → computeBillableDays(calendarDays, cap)).
 * That reads like a discount, and on a long rental it is one — six
 * calendar days of Communications gear bills three. But the cap can only
 * ever take days OFF a week, so on a rental no longer than the cap it
 * takes nothing:
 *
 *   3-day COMM/PRO_SUPPLIES/ART job → 3 calendar days → 3 billable days
 *   5-day VEHICLES job              → 5 → 5
 *   any GE job up to a week         → n → n   (GE's week IS 7)
 *
 * Every one of those goes out at full rate, and the only lever — the
 * section's 2-day / 1-day week — is a select that reads "Week…", says
 * nothing about money, and is easy to never touch. The agent who never
 * touches it does not know they just quoted the highest number the
 * system can produce.
 *
 * ── What this module is ────────────────────────────────────────────
 *
 * The arithmetic behind asking. Given the builder's rows it answers, per
 * department section: which week is in effect RIGHT NOW (read off the
 * rows, not off the last button anyone pressed), what the shorter weeks
 * would price the section at, and what each one is worth in dollars. The
 * builder shows that and makes the agent say which week they meant
 * before the paper leaves.
 *
 * It never changes a price on its own. Choosing is the agent's; this only
 * makes sure they were asked.
 */

import type { LineItemDepartment, RateType } from '@prisma/client'
import {
  BILLING_RULES,
  calendarDays,
  computeBillableDays,
  computeLineTotal,
  defaultWeekCap,
  weekCapChoices,
} from './billing'
import { matchesSpecialtyName } from '../pricing/specialtyVehicles'

/** The builder row, reduced to what the week question needs. */
export interface WeekLine {
  department: LineItemDepartment
  quantity: number
  rate: number
  rateType: RateType
  /** NULL = dates TBD. Undated lines are never guessed at, only skipped. */
  billableDays: number | null
  /** ISO YYYY-MM-DD; empty string = TBD. */
  pickupDate: string
  returnDate: string
  /** A catalog binding. Its ABSENCE is what opens the specialty NAME
   *  test — see `weekCapExempt`. */
  catalogProductId?: string | null
  description?: string
  /**
   * "Is this row outside the week?" — answered by a caller that knows
   * better than the name test below. When set it IS the answer, in both
   * directions.
   *
   * The builder cannot answer it: it holds no catalog row, so
   * `weekCapExempt` falls back to reading the description. The ORDER
   * page can, and does, for the two rows a week must never be quoted on:
   *
   *   · Specialty vehicles — its rows carry `isSpecialtyVehicle`, their
   *     SubRentals and their own createdAt, which is exactly what
   *     `billsAsSpecialtyVehicle` reads and exactly what the bulk-days
   *     route refuses the write by.
   *   · FLAT rows — bulk-days skips them, so a week quoted with their
   *     saving folded in would promise a number the write cannot
   *     produce.
   *
   * Either way the rule is the same: never quote a discount the write
   * would refuse.
   */
  weekExempt?: boolean
}

/**
 * Lines that must never be offered a week cap.
 *
 * Specialty vehicles bill calendar days with no weekly reduction (Wes
 * 2026-09-07, widened to the class 2026-09-10) — the order detail page
 * already refuses to show them cap chips, and the bulk-days and
 * dates/apply routes refuse to write one. The builder can only apply the
 * NAME rule: it holds no catalog row's `isSpecialtyVehicle`, so a
 * catalogued specialty unit (a restroom trailer) is invisible to it here.
 * That gap is the order page's to close, and it closes it by passing
 * `weekExempt` — the same `billsAsSpecialtyVehicle` verdict the
 * bulk-days route writes by. What matters either way is that the prompt
 * never quotes a discount the write would refuse.
 */
export function weekCapExempt(line: WeekLine): boolean {
  if (line.weekExempt != null) return line.weekExempt
  return !line.catalogProductId && matchesSpecialtyName(line.description)
}

/** Lines in a section whose price the week cap actually moves. */
export function weekPricedLines(lines: WeekLine[]): WeekLine[] {
  return lines.filter(
    (l) =>
      BILLING_RULES[l.department].model !== 'PURCHASE' &&
      !weekCapExempt(l) &&
      !!l.pickupDate &&
      !!l.returnDate &&
      l.billableDays != null,
  )
}

function span(line: WeekLine): number {
  return calendarDays(new Date(line.pickupDate), new Date(line.returnDate))
}

function totalAt(line: WeekLine, days: number): number {
  return computeLineTotal({
    quantity: line.quantity,
    rate: line.rate,
    billableDays: days,
    rateType: line.rateType,
    department: line.department,
  })
}

/**
 * The week in effect, read off the rows themselves.
 *
 *   a number — every priced row's day count is what that week produces
 *              from its own dates. When several weeks would produce the
 *              same counts (a one-day rental bills one day at every
 *              week), the LONGEST is reported: nothing has been given
 *              away yet.
 *   'custom' — no single week explains the rows. Someone typed days by
 *              hand, or repriced part of the section. A deliberate act;
 *              never nagged about.
 *   null     — nothing here is priced by a week (no dated rows, or the
 *              department has no week).
 */
export function capInEffect(
  department: LineItemDepartment,
  lines: WeekLine[],
): number | 'custom' | null {
  const choices = weekCapChoices(department)
  if (choices.length === 0) return null
  const priced = weekPricedLines(lines)
  if (priced.length === 0) return null
  let shared = choices
  for (const line of priced) {
    const cal = span(line)
    if (!Number.isFinite(cal)) return 'custom'
    shared = shared.filter((cap) => computeBillableDays(cal, cap) === line.billableDays)
    if (shared.length === 0) return 'custom'
  }
  return Math.max(...shared)
}

export interface WeekOption {
  cap: number
  /** Billable days this week produces across the whole section. */
  days: number
  /** Section subtotal at this week. */
  total: number
  /** total − the section's current subtotal. Negative = cheaper. */
  delta: number
  /** True when this is the department's standard week. */
  isStandard: boolean
  /** True when the rows already price at this week. */
  isCurrent: boolean
  /**
   * The ONE per-row day count this week produces — or null when the
   * section's rows carry different date ranges and therefore land on
   * different counts.
   *
   * A week is per-row arithmetic (each row's own calendar range, capped),
   * and the builder applies it that way. The order page cannot: it writes
   * through `/line-items/bulk-days`, which sets a single number across
   * the department. So it needs to know whether one number says the same
   * thing as the week — and when it does not, say so rather than write a
   * count that over-bills the short row and under-bills the long one.
   */
  uniformDays: number | null
}

export interface WeekSection {
  department: LineItemDepartment
  /** Weeks this department can bill, longest first. */
  options: WeekOption[]
  /** What the rows price at today — see `capInEffect`. */
  current: number | 'custom'
  /** The department's standard week. */
  standard: number
  /** The section's subtotal as it stands. */
  currentTotal: number
  /** Priced rows behind the numbers, and rows the week cannot touch. */
  pricedCount: number
  skippedCount: number
  /** Widest calendar span among the priced rows — what an agent reads to
   *  sanity-check the day counts ("6 days on the calendar, billing 3"). */
  calendarDays: number
  /** Billable days across the section as it stands. */
  currentDays: number
}

/**
 * One section's week question, priced. Returns null when there is nothing
 * to ask — no week for this department, or no dated rows yet.
 */
export function weekSection(
  department: LineItemDepartment,
  lines: WeekLine[],
): WeekSection | null {
  const rows = lines.filter((l) => l.department === department)
  const priced = weekPricedLines(rows)
  const current = capInEffect(department, rows)
  if (current == null || priced.length === 0) return null
  const standard = defaultWeekCap(department)
  if (standard == null) return null

  const currentTotal = priced.reduce((sum, l) => sum + totalAt(l, l.billableDays as number), 0)
  const currentDays = priced.reduce((sum, l) => sum + (l.billableDays as number), 0)

  const options: WeekOption[] = weekCapChoices(department).map((cap) => {
    let days = 0
    let total = 0
    const perRow = new Set<number>()
    for (const line of priced) {
      const d = computeBillableDays(span(line), cap)
      days += d
      total += totalAt(line, d)
      perRow.add(d)
    }
    return {
      cap,
      days,
      total,
      delta: total - currentTotal,
      isStandard: cap === standard,
      isCurrent: current === cap,
      uniformDays: perRow.size === 1 ? [...perRow][0] : null,
    }
  })

  return {
    department,
    options,
    current,
    standard,
    currentTotal,
    currentDays,
    pricedCount: priced.length,
    skippedCount: rows.length - priced.length,
    calendarDays: priced.reduce((max, l) => Math.max(max, span(l)), 0),
  }
}

/**
 * The weeks somebody already chose, read off the rows.
 *
 * `decided` is session memory: the builder fills it as the agent uses the
 * section select, and within one build that is the whole story. The ORDER
 * page has no such session — the quote it is about to send may have been
 * priced days ago by someone else, and the only surviving record of that
 * decision is the rows themselves.
 *
 * So a section already priced BELOW its department's standard week counts
 * as answered. Somebody moved it off the default, which is as deliberate
 * an act as typing the days by hand (already respected, as 'custom'), and
 * the exposure Wes named — "it goes out full rate" — is not what this
 * section is doing. Measured against 25 live quotes on 2026-09-11: this
 * is the difference between asking about four sections on one order and
 * asking about the one that is actually at full rate.
 *
 * Deliberately NOT applied inside `weekDecisionsPending`: the builder's
 * rows can reach a short week without anyone choosing it (the extractor
 * pre-fills days from the client's own email), and there "nobody has
 * answered yet" is still true.
 */
export function weekDecisionsOnRecord(
  lines: WeekLine[],
): Partial<Record<LineItemDepartment, number>> {
  const out: Partial<Record<LineItemDepartment, number>> = {}
  for (const department of new Set(lines.map((l) => l.department))) {
    // capInEffect reads whatever rows it is handed — the department
    // filter is the CALLER's, as it is in weekSection. Handing it the
    // whole order reads two departments' day counts as one section and
    // answers 'custom' for both.
    const rows = lines.filter((l) => l.department === department)
    const current = capInEffect(department, rows)
    const standard = defaultWeekCap(department)
    if (typeof current === 'number' && standard != null && current < standard) {
      out[department] = current
    }
  }
  return out
}

/**
 * The sections an agent should be asked about before the paper leaves.
 *
 * A section qualifies when ALL of:
 *   · it prices by a week and has dated rows;
 *   · nobody has chosen its week this session (`decided`) — using the
 *     section select counts, and so does typing days by hand, which
 *     shows up as `current === 'custom'`;
 *   · a shorter week would actually change the money. On a one-day
 *     rental every week bills one day, so there is nothing to ask and
 *     the prompt stays out of the way.
 *
 * Sorted by what the deepest available week is worth — the section where
 * the quote is most exposed comes first.
 */
export function weekDecisionsPending(
  lines: WeekLine[],
  decided: Partial<Record<LineItemDepartment, number>>,
): WeekSection[] {
  const departments = Array.from(new Set(lines.map((l) => l.department)))
  const out: WeekSection[] = []
  for (const department of departments) {
    if (decided[department] != null) continue
    const section = weekSection(department, lines)
    if (!section) continue
    if (section.current === 'custom') continue
    if (!section.options.some((o) => o.delta < 0)) continue
    out.push(section)
  }
  return out.sort(
    (a, b) =>
      Math.min(...a.options.map((o) => o.delta)) - Math.min(...b.options.map((o) => o.delta)),
  )
}
