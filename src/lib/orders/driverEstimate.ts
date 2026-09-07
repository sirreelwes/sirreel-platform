/**
 * The estimated driver day on a quote line.
 *
 * Wes 2026-09-07: "refine the driver billing details. Ideally we can enter
 * estimated details: Roll, Call Time, Leave Set, Done after fuel and clean."
 *
 * Four clock readings, the same four the driver logs on the day:
 *   roll     → left lot        (the driver leaves our / the partner's lot)
 *   callTime → on set          (the production's call)
 *   leaveSet → left set
 *   done     → wrap            (fuelled, cleaned, parked)
 * Hours are wrap − roll, portal to portal, via the SAME arithmetic the
 * driver's actual hours use (computePortalHours), so the estimate on the
 * quote and the number on the invoice can never disagree about what a
 * "day" is. The covered hours come from the fee ("Driver (covers 10 hrs)"),
 * and the money comes from driverRate.ts — the same ladder the day rate is
 * built from, so a 10.5-hour span prices to exactly the $550 day rate.
 *
 * Stored as OrderLineItem.driverEstimate JSON; rendered as a sentence under
 * the driver line on the quote and on the order page. It never CHANGES the
 * line's total on its own — a rep applies it — so a quote can never move
 * money without someone deciding to.
 */
import { computePortalHours, normalizeClock } from '@/lib/drivers/hoursEntry'
import { computeDriverPay, driverPayBreakdown, DRIVER_LUNCH_HOURS, type DriverPay } from '@/lib/orders/driverRate'

export interface DriverEstimate {
  /** "HH:MM" 24h. Roll is required; the rest optional. */
  roll: string
  callTime: string | null
  leaveSet: string | null
  done: string | null
}

export interface DriverEstimateView extends DriverEstimate {
  /** done − roll, portal to portal. Null until `done` is set. */
  hours: number | null
  /** From "(covers N hrs)" on the line description, when present. */
  coveredHours: number | null
  /** hours − coveredHours, floored at 0. Null when either side is unknown. */
  beyondCovered: number | null
  /** The ladder applied to the estimated span — $50/hr, 1.5× after 8, 2×
   *  after 12, less the half-hour lunch. Null until `done` is set. */
  pay: DriverPay | null
  overnight: boolean
}

/** Parse the stored JSON (or a request body) into a validated estimate, or an error. */
export function parseDriverEstimate(raw: unknown): { ok: true; value: DriverEstimate | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'object') return { ok: false, error: 'Driver estimate must be an object.' }
  const o = raw as Record<string, unknown>
  const pick = (k: string): string | null => {
    const v = o[k]
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'string') return '__bad__'
    return v
  }
  const roll = pick('roll'), callTime = pick('callTime'), leaveSet = pick('leaveSet'), done = pick('done')
  if ([roll, callTime, leaveSet, done].includes('__bad__')) return { ok: false, error: 'Times must be clock readings like 06:00.' }
  if (!roll && !callTime && !leaveSet && !done) return { ok: true, value: null }
  if (!roll) return { ok: false, error: 'Roll (leaving the lot) is required for a driver estimate.' }
  const r = computePortalHours({ leftLot: roll, onSet: callTime, leftSet: leaveSet, wrap: done })
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, value: { roll: r.startTime, callTime: r.onSetTime, leaveSet: r.leftSetTime, done: r.endTime } }
}

/** "Driver (covers 10 hrs)" → 10. */
export function coveredHoursFromDescription(description: string | null | undefined): number | null {
  const m = /covers\s+(\d+(?:\.\d+)?)\s*hrs?/i.exec(description ?? '')
  return m ? Number(m[1]) : null
}

export function viewDriverEstimate(est: DriverEstimate | null, description?: string | null): DriverEstimateView | null {
  if (!est) return null
  const r = computePortalHours({ leftLot: est.roll, onSet: est.callTime, leftSet: est.leaveSet, wrap: est.done })
  if (!r.ok) return null
  const coveredHours = coveredHoursFromDescription(description)
  const hours = r.hours === null ? null : Math.round(r.hours * 4) / 4
  return {
    ...est,
    hours,
    coveredHours,
    beyondCovered: hours !== null && coveredHours !== null ? Math.max(0, Math.round((hours - coveredHours) * 4) / 4) : null,
    pay: hours === null ? null : computeDriverPay(hours),
    overnight: r.overnight,
  }
}

/** 06:00 → 6:00 AM, for people. */
export function clock12(hhmm: string | null): string {
  if (!hhmm) return '—'
  const n = normalizeClock(hhmm)
  if (!n) return hhmm
  const [h, m] = n.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

const fmtHours = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))

/**
 * The sentence under the driver line on the quote: the estimated day, the
 * hours it comes to, the ladder applied to them, and the money that falls
 * out — always labelled an estimate, because the invoice bills actuals
 * (Wes 2026-09-07 gave the ladder: $50/hr, 1.5× after 8, 2× after 12, less
 * a half-hour lunch).
 */
export function driverEstimateSentence(v: DriverEstimateView): string {
  const stamps = [
    `roll ${clock12(v.roll)}`,
    v.callTime ? `call ${clock12(v.callTime)}` : null,
    v.leaveSet ? `leave set ${clock12(v.leaveSet)}` : null,
    v.done ? `done ${clock12(v.done)}${v.overnight ? ' (next day)' : ''}` : null,
  ].filter(Boolean).join(' \u00b7 ')
  if (v.hours === null || !v.pay) {
    return `Estimated day: ${stamps}. Driver time is billed portal to portal; the invoice reflects the hours actually worked.`
  }
  const p = v.pay
  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
  return (
    `Estimated day: ${stamps} \u2014 ${fmtHours(p.spanHours)} hrs portal to portal, ` +
    `${fmtHours(p.paidHours)} paid after a ${DRIVER_LUNCH_HOURS === 0.5 ? '\u00bd' : String(DRIVER_LUNCH_HOURS)}-hour meal break: ` +
    `${driverPayBreakdown(p)} \u2248 ${money(p.total)}. ` +
    `This is an estimate \u2014 the invoice reflects the hours actually worked.`
  )
}
