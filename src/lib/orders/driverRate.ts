/**
 * What a driver day costs — the ladder every driver number on a quote or an
 * invoice is built from.
 *
 * Wes 2026-09-07: "Overtime is always backed into an 8 hr day. So the hourly
 * rate is a clean $50/hr and 1.5 time after 8, 2x time after 12. For now
 * let's build in a 1/2 hr lunch standard."
 *
 * The existing day rates already ARE this ladder — "Driver (covers 10 hrs)"
 * at $550 is 8 × $50 + 2 × $75, to the dollar. So this module does not
 * introduce a new price; it makes the arithmetic behind the day rate
 * explicit, which is what lets a quote say "your 14.5-hour day is about
 * $900" instead of quoting a 10-hour day and invoicing a surprise.
 *
 * ── The lunch ───────────────────────────────────────────────────────────
 * A half hour is deducted from the portal-to-portal span before pay is
 * computed. Note this deliberately differs from `computePortalHours`, which
 * records the span itself and takes no break out ("a driver's meal on a
 * 14-hour day is inside the portal-to-portal span by definition"). Both are
 * right: the span is what happened, the paid hours are what is billed. Wes's
 * "for now" is why the deduction is a named constant rather than a literal.
 */

/** Straight time, per hour. */
export const DRIVER_HOURLY_RATE = 50
/** Hours at straight time before time-and-a-half begins. */
export const DRIVER_OT_AFTER_HOURS = 8
/** Hours before double time begins. */
export const DRIVER_DOUBLE_AFTER_HOURS = 12
/** Unpaid meal, deducted from the portal-to-portal span. */
export const DRIVER_LUNCH_HOURS = 0.5

export interface DriverPay {
  /** The portal-to-portal span, as given. */
  spanHours: number
  /** span − lunch, floored at 0. What the ladder is applied to. */
  paidHours: number
  straightHours: number
  otHours: number
  doubleHours: number
  straightPay: number
  otPay: number
  doublePay: number
  total: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The ladder, applied to a portal-to-portal span.
 *
 * 8 at $50, the next 4 at $75, everything past 12 at $100 — after the
 * half-hour lunch comes out of the span.
 */
export function computeDriverPay(spanHours: number): DriverPay {
  const span = Math.max(0, spanHours)
  const paid = Math.max(0, round2(span - DRIVER_LUNCH_HOURS))
  const straightHours = Math.min(paid, DRIVER_OT_AFTER_HOURS)
  const otHours = round2(Math.max(0, Math.min(paid, DRIVER_DOUBLE_AFTER_HOURS) - DRIVER_OT_AFTER_HOURS))
  const doubleHours = round2(Math.max(0, paid - DRIVER_DOUBLE_AFTER_HOURS))
  const straightPay = round2(straightHours * DRIVER_HOURLY_RATE)
  const otPay = round2(otHours * DRIVER_HOURLY_RATE * 1.5)
  const doublePay = round2(doubleHours * DRIVER_HOURLY_RATE * 2)
  return {
    spanHours: round2(span),
    paidHours: paid,
    straightHours: round2(straightHours),
    otHours,
    doubleHours,
    straightPay,
    otPay,
    doublePay,
    total: round2(straightPay + otPay + doublePay),
  }
}

/** The span a given day rate buys, by the same ladder — the inverse of the
 *  above. "$550 covers 10 hrs" is this, and it is how a quoted day rate and
 *  a quoted span are checked against each other. */
export function coveredSpanForDayRate(dayRate: number): number {
  const straightMax = DRIVER_OT_AFTER_HOURS * DRIVER_HOURLY_RATE
  const otMax = straightMax + (DRIVER_DOUBLE_AFTER_HOURS - DRIVER_OT_AFTER_HOURS) * DRIVER_HOURLY_RATE * 1.5
  let paid: number
  if (dayRate <= straightMax) paid = dayRate / DRIVER_HOURLY_RATE
  else if (dayRate <= otMax) paid = DRIVER_OT_AFTER_HOURS + (dayRate - straightMax) / (DRIVER_HOURLY_RATE * 1.5)
  else paid = DRIVER_DOUBLE_AFTER_HOURS + (dayRate - otMax) / (DRIVER_HOURLY_RATE * 2)
  return round2(paid + DRIVER_LUNCH_HOURS)
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const hrs = (n: number) => (Number.isInteger(n) ? `${n}` : String(round2(n)))

/** "8 hrs at $50, 4 at $75, 2 at $100" — the tiers that actually apply. */
export function driverPayBreakdown(p: DriverPay): string {
  const parts: string[] = []
  if (p.straightHours > 0) parts.push(`${hrs(p.straightHours)} hrs at ${money(DRIVER_HOURLY_RATE)}`)
  if (p.otHours > 0) parts.push(`${hrs(p.otHours)} at ${money(DRIVER_HOURLY_RATE * 1.5)} (1.5×)`)
  if (p.doubleHours > 0) parts.push(`${hrs(p.doubleHours)} at ${money(DRIVER_HOURLY_RATE * 2)} (2×)`)
  return parts.join(', ')
}

/** The client-facing terms sentence, stated once on the quote. */
export const DRIVER_RATE_TERMS = `Driver time is billed portal to portal at ${money(DRIVER_HOURLY_RATE)}/hour, time-and-a-half after ${DRIVER_OT_AFTER_HOURS} hours and double time after ${DRIVER_DOUBLE_AFTER_HOURS}, less a half-hour meal break.`
