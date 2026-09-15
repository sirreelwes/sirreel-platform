/**
 * Walkies are ONE product to everyone but the shelf.
 *
 * Wes, 2026-09-15: "For the walkies, let's remove from the order form
 * anything that indicates whether they are digital, analog, or sub from
 * another company. From the client side, it should only look like the
 * Motorola CP200. Also, we should remove sub from the inventory, and
 * instead we should have HQ manage whether or not we need to sublease the
 * walkies from another company."
 *
 * The catalog had three rows a rep could put on a quote — "(Analog)",
 * "(Digital)" and "(Sub)" — and reps picked between them by coin flip
 * (11 analog lines, 8 digital in the three weeks to 9/15, same $10/day).
 * The distinction is the warehouse's, not the client's.
 *
 * ── Why the two stock rows are NOT merged ─────────────────────────────
 * Analog (103733) and digital (104387) are RentalWorks I-codes, and the
 * nightly unit sync (lib/rentalworks/syncInventoryUnits.ts) re-links all
 * 545 barcoded radios to their row BY I-CODE. Folding one row into the
 * other would be undone the next morning. So both rows stay as stock, and
 * the ordering side is collapsed instead:
 *
 *   - the DIGITAL row is the one a line binds to, and is named
 *     "Motorola CP200" (the rename is data — scripts/walkies-one-product.ts);
 *   - the ANALOG row is STOCK-ONLY: counted in the pool, pullable, and
 *     scannable, but never offered by any picker, matcher or client
 *     surface. A scan of an analog radio resolves to the order row, so it
 *     lands on a walkie line whichever radio the floor grabbed;
 *   - the SUB row (CP200S — zero on hand, zero references) is archived.
 *     Subbing is now a decision HQ makes from the pool
 *     (lib/catalog/walkiePool.ts), recorded as a SubRental on the line.
 *
 * Codes, not ids or names — names drift, and ids differ per environment.
 */

/** What every client, quote and order form calls a walkie. */
export const WALKIE_NAME = 'Motorola CP200'

/** The row every walkie line binds to (RW I-code, the digital radios). */
export const WALKIE_ORDER_CODE = '104387'

/**
 * Stock rows that fill walkie orders but are never offered themselves.
 * The analog radios.
 */
export const STOCK_ONLY_CODES: readonly string[] = ['103733']

/** Every row whose units count toward the walkie pool. */
export const WALKIE_FAMILY_CODES: readonly string[] = [WALKIE_ORDER_CODE, ...STOCK_ONLY_CODES]

/** Retired 2026-09-15 — the "(Sub)" row. Subbing is HQ's call now. */
export const RETIRED_WALKIE_CODES: readonly string[] = ['CP200S']

export function isWalkieFamilyCode(code: string | null | undefined): boolean {
  return !!code && WALKIE_FAMILY_CODES.includes(code)
}

export function isStockOnlyCode(code: string | null | undefined): boolean {
  return !!code && STOCK_ONLY_CODES.includes(code)
}

/**
 * Prisma filter fragment: leave the stock-only rows out. Spread into any
 * `inventoryItem` where clause that feeds an ordering or client surface.
 * Uses `NOT`, so a caller that already sets `NOT` must merge by hand.
 */
export const NOT_STOCK_ONLY_WHERE = {
  NOT: { code: { in: [...STOCK_ONLY_CODES] } },
} as const

/**
 * "Motorola CP200  UHF Radio (Analog)" → "Motorola CP200", anywhere in a
 * string (a kit line's note reads "Included with 12 × Motorola CP200  UHF
 * Radio (Analog)"). Matches only the RADIO — "Motorola CP200 6-Bank
 * Charger" and "Motorola CP200 Battery" are different things and keep
 * their names. Returns the input unchanged when there is nothing to do.
 */
const VARIANT_NAME_RE = /motorola\s+cp200d?\s+uhf\s+radio(?:\s*\((?:analog|digital|sub)\))?(?:\s+complete)?/gi

export function walkieClientName(text: string): string
export function walkieClientName(text: string | null): string | null
export function walkieClientName(text: string | null): string | null {
  if (!text) return text
  return text.replace(VARIANT_NAME_RE, WALKIE_NAME)
}

// ── The pool: does HQ have enough radios, or does it need to sub? ──────

/** One order's walkies, on inclusive calendar days (yyyy-mm-dd). */
export interface WalkieDemand {
  orderId: string
  quantity: number
  start: string
  end: string
  /**
   * committed — the client said yes (or the radios are out): holds stock.
   * quoted    — a quote is out: would hold stock if it lands.
   * draft     — nobody has seen it: only ever counts for its own order.
   */
  hold: 'committed' | 'quoted' | 'draft'
}

/** Radios sub-rented in, on inclusive calendar days. */
export interface WalkieSubIn {
  quantity: number
  start: string
  end: string
}

export interface WalkieShortfall {
  /** Radios on the books across the stock rows. */
  pool: number
  /** The worst day in the window, or null when the window is empty. */
  peakDay: string | null
  /** Radios held on the peak day by committed orders, this one included. */
  bookedAtPeak: number
  /** Radios sub-rented in covering the peak day. */
  subbedAtPeak: number
  /** How many to sub so this order goes out whole. 0 = covered. */
  short: number
  /**
   * The same question if every quote out also lands. Always ≥ short.
   * Advisory — a quote holds nothing, so this never raises an alarm on
   * its own.
   */
  shortIfQuotesLand: number
  quotedPeakDay: string | null
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Inclusive day list. Both bounds are @db.Date values (midnight UTC). */
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = []
  const a = new Date(`${start}T00:00:00.000Z`)
  const b = new Date(`${end}T00:00:00.000Z`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return out
  // A runaway window (a typo'd year) must not spin; no rental is 400 days.
  for (let d = a, n = 0; d <= b && n < 400; d = new Date(d.getTime() + 86_400_000), n++) {
    out.push(dayKey(d))
  }
  return out
}

/**
 * The shortfall for ONE order's walkies, treating that order as landing.
 *
 * Per day: committed radios (every committed order, plus this one even if
 * it is only quoted) against the pool plus whatever is sub-rented in that
 * day. The answer is the worst day. Summing across the window instead
 * would call a Mon–Tue booking and a Thu–Fri booking a conflict.
 *
 * Pure: the caller loads the rows (walkiePool.ts) and this decides.
 */
export function walkieShortfall(args: {
  pool: number
  orderId: string
  demands: WalkieDemand[]
  subs: WalkieSubIn[]
}): WalkieShortfall {
  const { pool, orderId, demands, subs } = args
  const mine = demands.filter((d) => d.orderId === orderId)
  const window = new Set(mine.flatMap((d) => daysBetween(d.start, d.end)))

  const empty: WalkieShortfall = {
    pool, peakDay: null, bookedAtPeak: 0, subbedAtPeak: 0,
    short: 0, shortIfQuotesLand: 0, quotedPeakDay: null,
  }
  if (window.size === 0) return empty

  const booked = new Map<string, number>()
  const quoted = new Map<string, number>()
  const subbed = new Map<string, number>()
  const add = (m: Map<string, number>, day: string, q: number) => {
    if (window.has(day)) m.set(day, (m.get(day) ?? 0) + q)
  }
  for (const d of demands) {
    const q = Math.max(0, Math.floor(d.quantity))
    if (q === 0) continue
    // This order counts as committed — the question is "can it go out".
    const holds = d.hold === 'committed' || d.orderId === orderId
    if (!holds && d.hold === 'draft') continue
    for (const day of daysBetween(d.start, d.end)) {
      if (holds) add(booked, day, q)
      else add(quoted, day, q)
    }
  }
  for (const s of subs) {
    const q = Math.max(0, Math.floor(s.quantity))
    for (const day of daysBetween(s.start, s.end)) add(subbed, day, q)
  }

  let peak: { day: string; gap: number } | null = null
  let quotedPeak: { day: string; gap: number } | null = null
  for (const day of [...window].sort()) {
    const supply = pool + (subbed.get(day) ?? 0)
    const gap = (booked.get(day) ?? 0) - supply
    const gapIfQuotes = gap + (quoted.get(day) ?? 0)
    // Ties keep the EARLIEST day — that is the one to act on first.
    if (!peak || gap > peak.gap) peak = { day, gap }
    if (!quotedPeak || gapIfQuotes > quotedPeak.gap) quotedPeak = { day, gap: gapIfQuotes }
  }

  return {
    pool,
    peakDay: peak!.day,
    bookedAtPeak: booked.get(peak!.day) ?? 0,
    subbedAtPeak: subbed.get(peak!.day) ?? 0,
    short: Math.max(0, peak!.gap),
    shortIfQuotesLand: Math.max(0, quotedPeak!.gap),
    quotedPeakDay: quotedPeak!.gap > 0 ? quotedPeak!.day : null,
  }
}
