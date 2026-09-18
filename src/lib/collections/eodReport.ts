import { prisma } from '@/lib/prisma'
import { openArTotal } from '@/lib/collections/collectible'
import { tallyOrderDay } from '@/lib/orders/dayTally'
import { pacificDayRange, pacificToday } from '@/lib/time/pacificDay'

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
 *   RentalWorks total    The day's WHOLE take, of which the card figure is a
 *                        slice — see below. HQ sees the part that flowed
 *                        through HQ; a wire Ana spots in the bank account and
 *                        marks paid in RW is invisible here.
 *   Orders / quotes      HQ-native only. Anything still written directly in RW
 *                        is not in these totals.
 *
 * ── The two money lines are NESTED, not parallel ───────────────────────────
 *
 * Wes, 2026-09-02: RentalWorks is "money that hits the RW collected — sometimes
 * that is cardpointe payments and sometimes that's an ACH or wire that hits
 * Bank Account and she marks as paid".
 *
 * So RentalWorks ⊇ CardPointe. Every card charge is also recorded against RW,
 * and the gap between the two lines is the non-card money: ACH, wire, cheques.
 * Ana's own sample reads $5,251.78 card inside $6,707.57 collected — $1,455.79
 * of it not on a card.
 *
 * This was worth getting right rather than guessing. Read as two independent
 * figures, the report double-counts the card take when anyone adds them up,
 * and `cardpointe > rentalworks` — which is impossible — looks like a normal
 * day. It is now a validation, and the non-card remainder is computed and
 * shown rather than left to the reader.
 *
 * So every figure arrives pre-filled with its provenance attached and Ana can
 * correct any of them before sending. A number she cannot override is a number
 * she would have to work around, and the report would quietly stop being true.
 *
 * Send writes `daily_collections` directly, which retires the Gmail parse for
 * every day sent this way.
 */

/**
 * The Pacific day helpers now live in src/lib/time/pacificDay.ts — pure, so the
 * orders day tally and its tests can bound a day without importing prisma. They
 * are re-exported here because a dozen modules import them from this file.
 */
export { pacificToday, pacificDayRange }

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
    /** Cleared non-card receipts (check / wire / ACH / Zelle / cash / other). */
    otherReceipts: number
    /** ACH originated but not yet cleared — Ana's "straggling ACH's". */
    achPending: number
    achPendingCount: number
    /** Open AR across the RW mirror, for the "where we stand" line. */
    outstandingTotal: number
    outstandingCount: number
    /** Cross-check for the RentalWorks field: invoices the mirror SAW flip to
     *  paid today. Whole invoice totals, so it overstates a part-payment —
     *  offered as a second opinion beside the figure, never as the figure. */
    rwObservedPaid: number
    rwObservedCount: number
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
    // The split and the value rules are `tallyOrderDay` in
    // src/lib/orders/dayTally.ts — the SAME function the /orders date filter
    // reads, so Ana's check of this report cannot be answered by a second
    // definition of "an order". Cancelled rows are fetched and dropped there
    // rather than filtered in SQL, so the tally can report how many it left out.
    prisma.order.findMany({
      where: { createdAt: receivedToday },
      select: { total: true, bookedTotal: true, quoteStatus: true, status: true, archivedAt: true },
    }),
    // Shared with the invoice list on the same page — see collectible.ts for
    // why a plain `remainingTotal > 0` roughly doubles this number.
    openArTotal(),
  ])

  const cardAmount = money(cardAgg._sum.amount) + money(cardAgg._sum.surchargeAmount)
  const otherReceipts = money(otherAgg._sum.amount)
  const hqReceipts = Math.round((cardAmount + otherReceipts) * 100) / 100
  const rwObserved = money(rwPaid._sum.invoiceTotal)

  const day = tallyOrderDay(orders)

  return {
    date: dateISO,
    cardpointe: {
      amount: cardAmount,
      count: cardAgg._count,
      source: 'Card payments taken in HQ today, including the processing fee.',
      partial: false,
    },
    rentalworks: {
      // The day's TOTAL collected, card included.
      //
      // Two imperfect views of it, and the bigger one wins. HQ receipts count
      // only money that flowed through HQ — a wire Ana spots in the bank and
      // marks paid in RW never touched this system, and on a day like that HQ
      // reports $0 against a real six-thousand-dollar take. The RW mirror's
      // paid observations catch those, at the cost of counting a part-paid
      // invoice at its full value.
      //
      // Neither is authoritative, so the default is whichever is larger and
      // the source line names which one it used. Defaulting low would have Ana
      // retyping the figure every evening, which is the habit that makes a
      // pre-filled form worse than a blank one.
      amount: Math.max(hqReceipts, rwObserved),
      count: rwObserved > hqReceipts ? rwPaid._count : cardAgg._count + otherAgg._count,
      source:
        rwObserved > hqReceipts
          ? `From ${rwPaid._count} RentalWorks invoice${rwPaid._count === 1 ? '' : 's'} seen paid today — whole invoice amounts, so a part-payment reads high.`
          : 'Everything HQ took today, card included. Add anything marked paid in RentalWorks that did not come through HQ.',
      partial: true,
    },
    ordersCreated: {
      amount: day.orders.amount,
      count: day.orders.count,
      source: 'Orders opened in HQ today. Anything written straight into RentalWorks is not counted.',
      partial: true,
    },
    quotesCreated: {
      amount: day.quotes.amount,
      count: day.quotes.count,
      source: 'Quotes opened in HQ today, still unwon.',
      partial: true,
    },
    context: {
      otherReceipts,
      achPending: money(achAgg._sum.amount),
      achPendingCount: achAgg._count,
      outstandingTotal: outstanding.total,
      outstandingCount: outstanding.count,
      rwObservedPaid: rwObserved,
      rwObservedCount: rwPaid._count,
    },
  }
}
