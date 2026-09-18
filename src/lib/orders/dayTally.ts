/**
 * "How many orders and quotes were created that day, and what were they worth?"
 *
 * Ana, 2026-09-17: "Is there a way I can check the drop down list of orders and
 * quotes and specify a certain date? … And a way to calculate the total value
 * while I'm searching would be great, too. That way I know if the EOD report
 * that gets generated is accurate or not."
 *
 * ── Why this is a shared module and not a second count ─────────────────────
 *
 * The EOD collections report already answers this question every evening
 * (`ordersCreated` / `quotesCreated` in src/lib/collections/eodReport.ts). A
 * date filter on /orders that counted rows its OWN way would not check the
 * report — it would just be a second number to argue with. So the arithmetic
 * lives here, in one pure function, and BOTH read it: the report renders it,
 * the orders list shows it beside the day's rows. If they ever disagree, it is
 * a bug in one query, never in two different definitions of "an order".
 *
 * ── The three rules, all inherited from the report ─────────────────────────
 *
 *  1. CANCELLED is out. A cancelled order is not business that was written.
 *     Note this is the one direction the /orders TABLE differs: its default
 *     view still lists cancelled rows, so the table can show more rows than
 *     the tally counts. `excludedCancelled` says how many, rather than leaving
 *     Ana to find the discrepancy by hand.
 *  2. A quote is DRAFT or SENT `quoteStatus`; everything else is on the books.
 *     Nothing here reads `status` for the split — an order can be BOOKED with
 *     a quoteStatus that has not caught up, and the money question is whether
 *     the client has said yes.
 *  3. Orders are worth `bookedTotal ?? total`; quotes are worth `total`.
 *     `total` keeps moving with post-booking edits, so it is only honest for
 *     the quote side; once an order is booked, `bookedTotal` is what was sold.
 *
 * DRAFT, LOST and ARCHIVED rows are all IN the tally, because the report
 * counts them — a quote written and lost the same afternoon was still written.
 * The /orders list hides all three by default, which is the other half of why
 * the row count under the card will not match the card. `includes` names them
 * so the difference reads as an explanation instead of an error.
 *
 * Pure: no prisma, no dates, no formatting. `npm run test:order-day-tally`.
 */

/** The only fields the tally reads. Prisma Decimals arrive as objects — the
 *  money() below takes anything Number() can make sense of. */
export interface DayTallyRow {
  quoteStatus: string
  status: string
  total: unknown
  bookedTotal?: unknown
  archivedAt?: Date | string | null
}

export interface TallyPart {
  count: number
  amount: number
}

export interface DayTally {
  /** On the books: booked, approved, won — anything past the quote stage. */
  orders: TallyPart
  /** Still a proposal. */
  quotes: TallyPart
  /** orders.amount + quotes.amount, rounded once. */
  total: number
  /** Counted here, hidden on the default /orders view — why the table is shorter. */
  includes: { drafts: number; lost: number; archived: number }
  /** Created that day but left out of the tally — why the table can be longer. */
  excludedCancelled: number
}

/** Cents-safe rounding, matching the EOD report's own `money()`. */
export const money = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100

/**
 * A quote until it is won: DRAFT and SENT are proposals, everything else is
 * business on the books. Exported because the EOD report splits the same rows.
 */
export const isQuoteRow = (o: { quoteStatus: string }): boolean =>
  o.quoteStatus === 'DRAFT' || o.quoteStatus === 'SENT'

/** True for a row the tally counts. Cancelled orders are not business. */
export const countsTowardDay = (o: { status: string }): boolean => o.status !== 'CANCELLED'

/**
 * Split a day's rows into orders and quotes with their values, and say what
 * the /orders table will show differently.
 *
 * Callers pass EVERY order created in the window — drafts, lost, archived and
 * cancelled included. Filtering happens here so the reconciliation counts have
 * something to count.
 */
export function tallyOrderDay(rows: DayTallyRow[]): DayTally {
  const counted = rows.filter(countsTowardDay)

  const quoteRows = counted.filter(isQuoteRow)
  const orderRows = counted.filter((o) => !isQuoteRow(o))

  const sum = (xs: DayTallyRow[], value: (o: DayTallyRow) => unknown): number =>
    money(xs.reduce((s, o) => s + money(value(o)), 0))

  const orders: TallyPart = {
    count: orderRows.length,
    amount: sum(orderRows, (o) => o.bookedTotal ?? o.total),
  }
  const quotes: TallyPart = {
    count: quoteRows.length,
    amount: sum(quoteRows, (o) => o.total),
  }

  return {
    orders,
    quotes,
    total: money(orders.amount + quotes.amount),
    includes: {
      drafts: counted.filter((o) => o.status === 'DRAFT').length,
      lost: counted.filter((o) => o.quoteStatus === 'LOST').length,
      archived: counted.filter((o) => !!o.archivedAt).length,
    },
    excludedCancelled: rows.length - counted.length,
  }
}

/**
 * One sentence naming what the table below the card will not match, or null
 * when the tally and a plain list of the day agree. Written here rather than
 * in the component so the wording is testable and cannot drift from the counts.
 */
export function reconciliationNote(t: DayTally): string | null {
  const hidden: string[] = []
  if (t.includes.drafts) hidden.push(`${t.includes.drafts} draft${t.includes.drafts === 1 ? '' : 's'}`)
  if (t.includes.lost) hidden.push(`${t.includes.lost} lost`)
  if (t.includes.archived) hidden.push(`${t.includes.archived} archived`)

  const parts: string[] = []
  if (hidden.length) parts.push(`Counts ${hidden.join(', ')} the list hides by default.`)
  if (t.excludedCancelled) {
    parts.push(
      `Leaves out ${t.excludedCancelled} cancelled order${t.excludedCancelled === 1 ? '' : 's'} the list still shows.`,
    )
  }
  return parts.length ? parts.join(' ') : null
}
