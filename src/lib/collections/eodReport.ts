import { prisma } from '@/lib/prisma'
import { openArTotal } from '@/lib/collections/collectible'

/**
 * The end-of-day collections report.
 *
 * Wes, 2026-09-02: "Ana usually sends an end of day collections report. Let's
 * make that automated."
 *
 * Ana has been assembling four numbers by hand every evening and emailing
 * them. The comedy of the current state is that HQ then reads them BACK:
 * /api/admin/backfill-collections logs into her Gmail, greps her own sentences
 * for "CardPointe: $…", and writes the result into `daily_collections` to feed
 * the dashboard widget. HQ already holds the underlying rows — it was
 * round-tripping them through a person and a mail parser.
 *
 * ── Why the figures are EDITABLE, not just computed ────────────────────────
 *
 * Because HQ can only honestly compute three and a half of the four.
 *
 *   Card receipts        HQ knows exactly. Every card charge runs through
 *                        /api/invoices/[id]/charge-saved-card and lands in
 *                        `Payment`. Solid.
 *   Other receipts       HQ knows what HQ recorded. A check Ana keys into
 *                        RentalWorks and nowhere else is invisible here.
 *   RentalWorks total    NOT a cash figure. The closest HQ has is "RW invoices
 *                        we OBSERVED flip to paid today" — the sync noticing a
 *                        state change, not RW's own daily receipts, and always
 *                        the whole invoice rather than the amount paid. It is a
 *                        starting number, not the answer.
 *   Orders / quotes      HQ-native only. Anything still written directly in RW
 *                        is not in these totals.
 *
 * So every figure arrives pre-filled with its provenance attached and Ana can
 * correct any of them before sending. A number she cannot override is a number
 * she would have to work around, and the report would quietly stop being true.
 *
 * Send writes `daily_collections` directly, which retires the Gmail parse for
 * every day sent this way.
 */

const PACIFIC = 'America/Los_Angeles'

/** Today's date in Pacific, as `YYYY-MM-DD`. The business day everywhere else
 *  in HQ is Pacific (see nextOrderNumber in src/lib/orders.ts). */
export function pacificToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * The UTC instants bounding a Pacific calendar day.
 *
 * Derived from the zone's actual offset on that date rather than a fixed -08:00
 * — eight months of the year Los Angeles is -07:00, and a hardcoded offset
 * would put an hour of every evening's takings in the wrong report twice a year.
 */
export function pacificDayRange(dateISO: string): { start: Date; end: Date } {
  const offsetAt = (utc: Date): number => {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: PACIFIC,
      timeZoneName: 'longOffset',
    })
      .formatToParts(utc)
      .find((p) => p.type === 'timeZoneName')?.value // "GMT-07:00"
    const m = s?.match(/GMT([+-])(\d{2}):(\d{2})/)
    if (!m) return -8 * 60
    const sign = m[1] === '-' ? -1 : 1
    return sign * (Number(m[2]) * 60 + Number(m[3]))
  }
  const naive = new Date(`${dateISO}T00:00:00Z`)
  // Two passes: the offset is looked up using a first approximation, then
  // re-checked at the resulting instant so a DST-transition day lands right.
  const first = new Date(naive.getTime() - offsetAt(naive) * 60000)
  const start = new Date(naive.getTime() - offsetAt(first) * 60000)
  const nextNaive = new Date(naive.getTime() + 86400000)
  const nextFirst = new Date(nextNaive.getTime() - offsetAt(nextNaive) * 60000)
  const end = new Date(nextNaive.getTime() - offsetAt(nextFirst) * 60000)
  return { start, end }
}

export interface EodFigure {
  /** Dollars. */
  amount: number
  /** How many rows produced it — "3 payments", "2 orders". */
  count: number
  /** One line saying where the number came from, shown next to the field. */
  source: string
  /** True when HQ cannot see the whole picture and Ana should expect to edit. */
  partial: boolean
}

export interface EodFigures {
  date: string
  cardpointe: EodFigure
  rentalworks: EodFigure
  ordersCreated: EodFigure
  quotesCreated: EodFigure
  /** Context for the note — things worth a sentence, not money fields. */
  context: {
    /** Cleared non-card receipts (check / wire / cash / other). */
    otherReceipts: number
    /** ACH originated but not yet cleared — Ana's "straggling ACH's". */
    achPending: number
    achPendingCount: number
    /** Open AR across the RW mirror, for the "where we stand" line. */
    outstandingTotal: number
    outstandingCount: number
  }
}

const money = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100
const CARD_METHODS = ['CARDPOINTE', 'CREDIT_CARD'] as const

export async function computeEodFigures(dateISO: string): Promise<EodFigures> {
  const { start, end } = pacificDayRange(dateISO)
  const receivedToday = { gte: start, lt: end }

  const [cardAgg, otherAgg, achAgg, rwPaid, orders, outstanding] = await Promise.all([
    // Card receipts. `amount` is what credits the invoice; the surcharge is
    // charged on top, so what CardPointe actually processed is the sum of both
    // — which is the figure that reconciles against their deposit.
    prisma.payment.aggregate({
      where: {
        status: 'CLEARED',
        voidedAt: null,
        method: { in: [...CARD_METHODS] },
        receivedAt: receivedToday,
      },
      _sum: { amount: true, surchargeAmount: true },
      _count: true,
    }),
    prisma.payment.aggregate({
      where: {
        status: 'CLEARED',
        voidedAt: null,
        method: { notIn: [...CARD_METHODS] },
        receivedAt: receivedToday,
      },
      _sum: { amount: true },
      _count: true,
    }),
    // Originated, not yet cleared. Not receipts — but the reason Ana writes
    // "I'll see about the straggling ACH's".
    prisma.payment.aggregate({
      where: { status: 'PENDING', voidedAt: null, method: 'ACH' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.rwInvoicePaidObservation.aggregate({
      where: { observedPaidAt: receivedToday, preTracking: false },
      _sum: { invoiceTotal: true },
      _count: true,
    }),
    // HQ-native orders opened today, split by whether they are still a quote.
    // bookedTotal is the money once an order is booked; `total` keeps moving
    // with post-booking edits, so it is only right for the quote side.
    prisma.order.findMany({
      where: { createdAt: receivedToday, status: { not: 'CANCELLED' } },
      select: { total: true, bookedTotal: true, quoteStatus: true, status: true },
    }),
    // Shared with the invoice list on the same page — see collectible.ts for
    // why a plain `remainingTotal > 0` roughly doubles this number.
    openArTotal(),
  ])

  const cardAmount = money(cardAgg._sum.amount) + money(cardAgg._sum.surchargeAmount)
  const otherReceipts = money(otherAgg._sum.amount)

  // A quote until it is won: DRAFT and SENT are proposals, everything else is
  // business on the books.
  const isQuote = (o: { quoteStatus: string }) => o.quoteStatus === 'DRAFT' || o.quoteStatus === 'SENT'
  const quoteRows = orders.filter(isQuote)
  const orderRows = orders.filter((o) => !isQuote(o))

  return {
    date: dateISO,
    cardpointe: {
      amount: cardAmount,
      count: cardAgg._count,
      source: 'Card payments taken in HQ today, including the processing fee.',
      partial: false,
    },
    rentalworks: {
      amount: money(rwPaid._sum.invoiceTotal) || otherReceipts + cardAmount,
      count: rwPaid._count,
      source: rwPaid._count
        ? 'RentalWorks invoices seen paid today (whole invoice, not the amount applied) — check against RW before sending.'
        : 'Nothing seen paid in RentalWorks today, so this is HQ receipts instead — check against RW before sending.',
      partial: true,
    },
    ordersCreated: {
      amount: orderRows.reduce((s, o) => s + money(o.bookedTotal ?? o.total), 0),
      count: orderRows.length,
      source: 'Orders opened in HQ today. Anything written straight into RentalWorks is not counted.',
      partial: true,
    },
    quotesCreated: {
      amount: quoteRows.reduce((s, o) => s + money(o.total), 0),
      count: quoteRows.length,
      source: 'Quotes opened in HQ today, still unwon.',
      partial: true,
    },
    context: {
      otherReceipts,
      achPending: money(achAgg._sum.amount),
      achPendingCount: achAgg._count,
      outstandingTotal: outstanding.total,
      outstandingCount: outstanding.count,
    },
  }
}
