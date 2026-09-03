/**
 * Booking details — the operational half of a quote.
 *
 * ── What this replaces ──────────────────────────────────────────────────
 * A block of prose Jose typed by hand into the Notes field of a quote on
 * 2026-09-03: lot hours, the truck vs van rental cycle, refueling, the
 * mileage allowance, driver parking, trash disposal, LCDW, cancellation,
 * and the card fee. Ten facts a client needs before they book, none of
 * which HQ had anywhere to put. The quote PDF offered exactly one
 * free-text `Notes` box and the send-quote email one free-text
 * `customMessage`, so this arrived on a client's quote only when the rep
 * remembered to paste it, in whatever wording that rep happened to keep.
 *
 * The facts live here as DATA instead, so every quote carries them and a
 * rate change is one edit rather than a hunt through everyone's clipboard.
 *
 * ── Two of these numbers are NOT ours ───────────────────────────────────
 * They already had a single source of truth, and this module reads it
 * rather than restating it:
 *
 *   - Lot hours   → YARD_HOURS (src/lib/site/yardHours.ts), the same rows
 *                   the after-hours packet prints.
 *   - Card fee    → CARD_SURCHARGE_RATE (src/lib/payments/surcharge.ts),
 *                   the rate the gateway actually applies.
 *   - Refueling,  → LCDW_DAILY_RATE / LCDW_WAIVED_DAMAGE_LIMIT /
 *     LCDW          FUEL_PER_GALLON (src/lib/contracts/fees.ts). These three
 *                   are CONTRACT terms — they change only when the rental
 *                   agreement changes, and they must stay in lockstep with
 *                   public/contracts/sirreel-rental-agreement.pdf. Quoting a
 *                   waiver price the signed agreement contradicts is the one
 *                   error here nobody would catch until a claim, so this
 *                   module reads them and never restates them.
 *
 * ── Two places this deliberately does NOT match the hand-typed prose ───
 * Both are cases where the prose promised a client something HQ knows to
 * be wrong, so the correction is the point of the exercise:
 *
 *  1. THE CARD FEE IS A CAP, NOT A FLAT RATE. The prose read "a 3%
 *     processing fee will apply to all credit card transactions". Under
 *     the CardPointe Merchant Surcharge Program the gateway WAIVES the fee
 *     for debit, prepaid, and cardholders in states that prohibit
 *     surcharging. This is not a new discovery — CC_SURCHARGE_TEXT in
 *     portal-v2/terms.ts was corrected from a flat 3% to a cap for exactly
 *     this reason, and the legacy portal kept promising the flat fee to
 *     every client who got a link until it was made to import the
 *     corrected string. Restating the flat version on the quote PDF would
 *     walk that straight back, so `cardFeeBody` states the cap and names
 *     the waivers, in lockstep with the portal disclosure.
 *
 *  2. LCDW IS NOT AVAILABLE ON EVERY VEHICLE. The prose offered "our
 *     optional limited damage policy is $24/day" with no exclusions. The
 *     rental agreement excludes PopVans, ProScout/VideoVans, restroom
 *     trailers, scissor lifts and anything needing a CDL, and it excludes
 *     partner units because the claim being waived is not SirReel's to
 *     waive. On 2026-09-02 a portal page told a client a hand-typed PopVan
 *     was covered — the incident that put the second net in
 *     lcdwEligibility.ts. So the LCDW term here is built THROUGH
 *     `quoteLcdw` on the order's own vehicle lines and names the
 *     exclusions on the quote, rather than making a blanket offer the
 *     agreement does not honour.
 *
 * Pure and offline: no prisma, no fetch, no `Date.now()`. It is imported by
 * the PDF renderer (server) and the client portal page (browser), so it must
 * stay that way — see the header of src/lib/site/yardHours.ts for what
 * pulling in a prisma-importing module costs here.
 */

import { CARD_SURCHARGE_RATE } from '@/lib/payments/surcharge'
import {
  LCDW_DAILY_RATE,
  LCDW_WAIVED_DAMAGE_LIMIT,
  FUEL_PER_GALLON,
} from '@/lib/contracts/fees'
import { YARD_HOURS_ONE_LINE } from '@/lib/site/yardHours'
import { quoteLcdw, type LcdwCandidate } from '@/lib/pricing/lcdwEligibility'

/**
 * The numbers that live NOWHERE ELSE. Every one is client-facing money or a
 * client-facing allowance, so treat a change here as a pricing change and not
 * a copy edit.
 *
 * The refueling rate and both LCDW figures are deliberately ABSENT: they are
 * contract terms and are re-exported below off src/lib/contracts/fees.ts.
 * Adding a second copy here is how the flat-3% card disclosure survived in
 * the legacy portal for months — two definitions, one of them quietly wrong.
 */
export const BOOKING_POLICY = {
  /** Hours past the 24-hour truck cycle, capped at one extra rental day. */
  truckHourlyOverage: 34,
  mileageIncludedPerDay: 100,
  mileageIncludedPerWeek: 500,
  mileageOveragePerMile: 0.5,
  /** Per bag, left by the locked dumpsters. */
  trashPerBag: 25,
  /** Cancel inside this window and the daily rate is owed. */
  cancellationWindowHours: 24,
  /** Business days a check / ACH payment must land within. */
  achDueBusinessDays: 3,
  /** Complimentary driver parking, by vehicle class. */
  parkingSpacesTruck: 2,
  parkingSpacesVan: 1,
  /** Contract terms — read from src/lib/contracts/fees.ts, never redefined. */
  refuelPerGallon: FUEL_PER_GALLON,
  lcdwPerDay: LCDW_DAILY_RATE,
  lcdwCoverage: LCDW_WAIVED_DAMAGE_LIMIT,
} as const

export type BookingTermKey =
  | 'lot-access'
  | 'truck-period'
  | 'van-period'
  | 'refueling'
  | 'mileage'
  | 'parking'
  | 'trash'
  | 'lcdw'
  | 'cancellation'
  | 'card-fees'

export interface BookingTerm {
  key: BookingTermKey
  title: string
  body: string
  /**
   * Small print under the body. Carries the qualifications that must not be
   * dropped when the block is squeezed — above all the LCDW exclusions.
   */
  note?: string
}

/** A VEHICLES-department line, as much of it as the terms need to judge. */
export interface BookingVehicleLine {
  description: string
  /** InventoryItem / category code when the line was picked from catalog. */
  code: string | null
  /** Fulfilled by a partner's unit (a SubRental). Never LCDW-eligible. */
  isPartnerVehicle?: boolean
}

export interface BookingTermsInput {
  /** The order's VEHICLES-department lines. Empty for a gear-only order. */
  vehicles: BookingVehicleLine[]
}

// ─────────────────────────────────────────────────────────────────────
// Money / copy helpers
// ─────────────────────────────────────────────────────────────────────

/** $34, $0.50, $1,000 — trailing ".00" dropped, cents kept when present. */
function money(n: number): string {
  const whole = Number.isInteger(n)
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

// ─────────────────────────────────────────────────────────────────────
// Truck vs van — which rental-period term applies
// ─────────────────────────────────────────────────────────────────────

/**
 * The two rental periods bill differently — a truck on a 24-hour cycle, a van
 * by the calendar day — so naming the wrong one on a quote misstates what the
 * client will be invoiced.
 *
 * Codes first, names second, mirroring judgeLcdwLine: catalog codes are
 * stable, and a rep who types "cube truck" instead of picking the row still
 * meant a cube truck.
 */
export type VehicleClass = 'truck' | 'van' | 'unknown'

const TRUCK_CODES: ReadonlySet<string> = new Set([
  'CAT_CUBE_TRUCK',
  'CAT_CAMERA_CUBE',
])

const VAN_CODES: ReadonlySet<string> = new Set([
  'CAT_CARGO_VAN_LIFTGATE',
  'CAT_CARGO_VAN_NO_LIFTGATE',
  'CAT_PASSENGER_VAN',
  'CAT_POPVAN',
  'CAT_PROSCOUT_VTR',
])

const TRUCK_NAME_PATTERNS: readonly RegExp[] = [
  /\bsuper\s*cube\b/i,
  /\bcube\s*truck\b/i,
  /\bcamera\s*cube\b/i,
  /\bstake\s*bed\b/i,
  /\bbox\s*truck\b/i,
  /\btruck\b/i,
]

const VAN_NAME_PATTERNS: readonly RegExp[] = [
  /\bcargo\s*van\b/i,
  /\bpop\s*van\b/i,
  /\bvideo\s*van\b/i,
  /\bpro\s*scout\b/i,
  /\bpassenger\s*van\b/i,
  /\bsprinter\b/i,
  /\bvan\b/i,
]

export function classifyVehicleLine(line: BookingVehicleLine): VehicleClass {
  if (line.code && TRUCK_CODES.has(line.code)) return 'truck'
  if (line.code && VAN_CODES.has(line.code)) return 'van'
  // Vans before trucks: "Video Van" and "PopVan" would both match /\btruck\b/
  // never, but "Cargo w/Lift Gate" matches neither — order matters only for a
  // description carrying both words, where the more specific van names win.
  if (VAN_NAME_PATTERNS.some((re) => re.test(line.description))) return 'van'
  if (TRUCK_NAME_PATTERNS.some((re) => re.test(line.description))) return 'truck'
  return 'unknown'
}

/**
 * Which of the two period terms to print.
 *
 * Narrowing to one is a nicety; getting it wrong tells a client the wrong
 * billing cycle. So it narrows only when EVERY vehicle line agrees, and shows
 * BOTH the moment anything is mixed or unrecognised — which is also how the
 * prose read, since it listed both. Trailers, honeywagons and lifts classify
 * as 'unknown' by design: they are neither, and the honest answer for them is
 * to show the pair and let the rep speak to it.
 */
export function periodTermsFor(vehicles: BookingVehicleLine[]): VehicleClass[] {
  if (vehicles.length === 0) return []
  const classes = new Set(vehicles.map(classifyVehicleLine))
  if (classes.size === 1 && !classes.has('unknown')) return [...classes]
  return ['truck', 'van']
}

// ─────────────────────────────────────────────────────────────────────
// The terms
// ─────────────────────────────────────────────────────────────────────

/**
 * The card-fee disclosure. A CAP, and it names the waivers — see point 1 in
 * the module header for why this must never be restated as a flat rate.
 * Pinned by tests/sales/booking-terms.test.ts.
 */
export const cardFeeBody = [
  `A processing fee of up to ${(CARD_SURCHARGE_RATE * 100).toFixed(0)}% is added to credit card payments where permitted.`,
  'The fee is waived on debit and prepaid cards, and for cardholders in states that do not allow it.',
  `To avoid it, pay by ACH or check — submitted within ${BOOKING_POLICY.achDueBusinessDays} business days so we can close out the project.`,
].join(' ')

/**
 * Build the booking-details block for one order.
 *
 * Vehicle-only terms (rental period, refueling, mileage, parking, LCDW) are
 * omitted entirely on a gear-only order rather than printed as boilerplate: a
 * client renting apple boxes has no fuel level to return at, and a term that
 * cannot apply teaches them to skim the ones that do.
 */
export function buildBookingTerms(input: BookingTermsInput): BookingTerm[] {
  const { vehicles } = input
  const hasVehicles = vehicles.length > 0
  const terms: BookingTerm[] = []

  terms.push({
    key: 'lot-access',
    title: 'Pickups & lot access',
    body: `${YARD_HOURS_ONE_LINE}. After-hours pickup and drop-off is available — just let us know ahead of time and we'll send the gate and container codes.`,
  })

  for (const cls of periodTermsFor(vehicles)) {
    if (cls === 'truck') {
      terms.push({
        key: 'truck-period',
        title: 'Truck rental period',
        body: `1 day = a 24-hour cycle. Return the truck within 24 hours of pickup and you are billed for 1 day. Additional hours are ${money(BOOKING_POLICY.truckHourlyOverage)}/hour, up to a maximum of 1 additional rental day.`,
      })
    }
    if (cls === 'van') {
      terms.push({
        key: 'van-period',
        title: 'Van rental period',
        body: '1 day = 1 calendar day, billed by the calendar days rented.',
      })
    }
  }

  if (hasVehicles) {
    terms.push({
      key: 'refueling',
      title: 'Refueling',
      body: `Vehicles go out fully (or close to) fueled and should come back at the same level. Refueling is billed at ${money(BOOKING_POLICY.refuelPerGallon)}/gallon.`,
    })

    terms.push({
      key: 'mileage',
      title: 'Mileage',
      body: `Includes ${BOOKING_POLICY.mileageIncludedPerDay} miles per rental day, or ${BOOKING_POLICY.mileageIncludedPerWeek} miles per week. Additional mileage is billed at ${money(BOOKING_POLICY.mileageOveragePerMile)}/mile.`,
      note: "Taking the vehicle out of the county? Let us know ahead of time so we can prep it properly for a long trip.",
    })

    terms.push({
      key: 'parking',
      title: 'Driver parking',
      body: parkingBody(vehicles),
    })

    const lcdw = lcdwTerm(vehicles)
    if (lcdw) terms.push(lcdw)
  }

  terms.push({
    key: 'trash',
    title: 'Trash',
    body: `Trash bags can be left by the locked dumpsters and disposed of for ${money(BOOKING_POLICY.trashPerBag)}/bag. Just let us know if anything has been dropped.`,
  })

  terms.push({
    key: 'cancellation',
    title: 'Cancellation',
    body: `Once the rental is confirmed, a cancellation within ${BOOKING_POLICY.cancellationWindowHours} hours of the pickup date is billed the daily rate of the rental.`,
  })

  terms.push({
    key: 'card-fees',
    title: 'Payment & card fees',
    body: cardFeeBody,
  })

  return terms
}

/**
 * Complimentary driver parking, stated for the classes actually on the order.
 * Two tandem spaces per truck, one per van.
 */
function parkingBody(vehicles: BookingVehicleLine[]): string {
  const classes = periodTermsFor(vehicles)
  const truck = `${BOOKING_POLICY.parkingSpacesTruck} in tandem per truck`
  const van = `${BOOKING_POLICY.parkingSpacesVan} per van`
  const which =
    classes.length === 1 && classes[0] === 'truck'
      ? truck
      : classes.length === 1 && classes[0] === 'van'
        ? van
        : `${truck}, ${van}`
  return `Complimentary parking for your driver's own vehicle is included — ${which}.`
}

/**
 * The LCDW offer, judged against THIS order's vehicles.
 *
 * Three outcomes, and the middle one is the whole reason this goes through
 * `quoteLcdw` instead of printing a blanket offer:
 *
 *   every vehicle eligible  → the plain offer
 *   some eligible           → the offer, plus a note naming what it does not cover
 *   none eligible           → say so. Not silence: a client who reads "$24/day
 *                             covers your vehicle" on a PopVan quote and finds
 *                             out at claim time is the exact failure
 *                             lcdwEligibility.ts exists to prevent.
 */
function lcdwTerm(vehicles: BookingVehicleLine[]): BookingTerm | null {
  const candidates: LcdwCandidate[] = vehicles.map((v, i) => ({
    id: String(i),
    description: v.description,
    code: v.code,
    department: 'VEHICLES',
    quantity: 1,
    billableDays: 1,
    isPartnerVehicle: v.isPartnerVehicle,
  }))
  const q = quoteLcdw(candidates)
  if (q.eligible.length === 0 && q.excluded.length === 0) return null

  const offer = `Our optional limited damage waiver is ${money(BOOKING_POLICY.lcdwPerDay)}/day per vehicle and covers the first ${money(BOOKING_POLICY.lcdwCoverage)} of damage to that vehicle. Full coverage details are in the rental agreement.`

  if (q.allExcluded) {
    return {
      key: 'lcdw',
      title: 'Limited damage waiver (LCDW)',
      body: `LCDW is not available on the vehicles on this order — ${listNames(q.excluded.map((e) => e.description))}. The waiver covers SirReel's own fleet rental vehicles only.`,
    }
  }

  return {
    key: 'lcdw',
    title: 'Limited damage waiver (LCDW)',
    body: offer,
    note:
      q.excluded.length > 0
        ? `Not available on ${listNames(q.excluded.map((e) => e.description))} — the waiver covers SirReel's own fleet rental vehicles only.`
        : undefined,
  }
}

/**
 * The subset that belongs on an INVOICE.
 *
 * Wes, 2026-09-03, choosing this over the full block: most booking terms are
 * PRE-booking information — lot hours, the rental cycle, cancellation, LCDW
 * all help someone decide whether to book, and are spent by the time they are
 * billed. Reprinting them on an invoice pads a billing document with terms
 * that can no longer be acted on.
 *
 * These four are different: each one explains a CHARGE that can appear as a
 * line on the final invoice, and each is a charge clients query. A $0.50/mile
 * overage or a $25 disposal line with nothing next to it explaining the rate
 * is how a billing question becomes a collections call, so the explanation
 * travels with the bill.
 *
 * Order follows the quote's, so a client comparing the two documents reads
 * the same terms in the same sequence.
 */
export const INVOICE_TERM_KEYS: readonly BookingTermKey[] = [
  'refueling',
  'mileage',
  'trash',
  'card-fees',
]

/**
 * Booking terms for an invoice: the charge-explaining four, in quote order.
 *
 * Built by FILTERING buildBookingTerms rather than composing its own strings,
 * so the invoice cannot state a rate the quote contradicts — the failure this
 * whole module exists to prevent, and the reason a client who was quoted one
 * mileage rate must never be billed against a different sentence.
 *
 * The vehicle gating comes along for free: a gear-only invoice has no
 * refueling or mileage term to carry, and drops to trash + card fees.
 *
 * Forward-looking NOTES are stripped. The one that survives the filter is
 * mileage's "let us know ahead of time if you're leaving the county" — an
 * instruction that is meaningless on a document issued after the vehicle came
 * back, and reads as boilerplate nobody proofread.
 */
export function buildInvoiceBookingTerms(input: BookingTermsInput): BookingTerm[] {
  return buildBookingTerms(input)
    .filter((t) => INVOICE_TERM_KEYS.includes(t.key))
    .map(({ note: _forwardLooking, ...t }) => t)
}

/** "the PopVan" / "the PopVan and the ProScout" / "A, B and C". */
function listNames(names: string[]): string {
  const unique = [...new Set(names)]
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
}
