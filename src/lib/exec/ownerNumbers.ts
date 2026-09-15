import {
  addDays,
  addMonths,
  dateOnlyKey,
  daysBetween,
  inRange,
  lastMonths,
  lastWeeks,
  monthRange,
  monthToDate,
  pacificDayKey,
  type DayRange,
} from './periods'

/**
 * The owner numbers page — sales, orders and collections on one screen, for
 * Wes only (see ownerAllowlist.ts).
 *
 * Wes, 2026-09-15: "now that we are fully working in HQ, I'd like to start
 * tracking sales and number of orders on a dashboard. maybe collections on
 * that same dashboard."
 *
 * This file is the PURE half: it takes rows and returns figures, so every
 * definition below is pinned by `npm run test:owner-numbers`. The Prisma half
 * is ownerNumbersQuery.ts.
 *
 * ── The definitions, and what each one cost to get right ──────────────────
 *
 * SALES are HQ orders, because HQ is the book now.
 *   new orders   created in the window. Archived orders are excluded — that
 *                action exists for duplicates, test orders and dead parses,
 *                which are not orders. CANCELLED ones still count: an order
 *                that was opened and then lost is still an order that came in.
 *   quoted       quote sent in the window (`quoteSentAt`), at `total`.
 *   won          `wonAt` in the window, not CANCELLED, at the booked snapshot
 *                (`bookedTotal`) when there is one — `total` keeps moving with
 *                post-booking edits — else `total` (APPROVED, not yet booked).
 *
 * INVOICED is RentalWorks + HQ invoices. RW is still where most billing
 * happens (Sept 1–15 2026: $105k in RW; every HQ invoice ever: $21k), and the two are
 * disjoint — HQ invoices are numbered SR-INV-3xxxx and never reach the mirror.
 *   - VOID RW invoices are dropped. RW keeps their totals populated, and they
 *     are not small: 12–192 a month, $78k–$208k. Leaving them in inflated every
 *     month by 30–45%.
 *   - CREDIT invoices stay in, negative. Invoiced is net.
 *   - HQ invoices count once sent (DRAFT is a pre-invoice, VOID is nothing), on
 *     the day they were sent.
 *
 * COLLECTED is two disjoint streams:
 *   - RW invoices seen paid off (`RwInvoicePaidObservation`, not preTracking).
 *     That catches the wire Ana marks paid in RW that never touched HQ, which
 *     is most collections money. It counts the whole invoice when it zeroes, so
 *     a part-payment reads late and in one lump. Tracking began 2026-08-19;
 *     weeks before that are "no data", never $0.
 *   - HQ invoice payments (`Payment`, CLEARED, not voided).
 *   Deliberately NOT `RwCollectionCharge`: a card charge on an RW invoice is
 *   already in the first stream once the mirror sees it paid, and a charge on
 *   an HQ invoice (rwInvoiceId `hq:…`) writes a Payment too. Adding it would
 *   count the same card twice.
 *
 * OPEN AR is the collectible RW set (collectible.ts — non-void, not paid-marked,
 * not written off) plus unpaid HQ invoice balances, aged from the invoice date.
 * SirReel has no Net terms, so age since invoicing IS lateness.
 */

/**
 * The first day HQ held the whole order book. Before this, orders were still
 * being written in Planyo and RentalWorks, so an August "same point last
 * month" is not a comparison, it is the migration: September's first half
 * shows ~100 orders against August's ~10. Sales comparisons are hidden when
 * the earlier window starts before this day, and appear on their own in
 * October.
 */
export const HQ_BOOK_START = '2026-09-01'

// ── Row shapes (what the query hands over) ───────────────────────────────

export interface OrderRow {
  createdAt: Date
  quoteSentAt: Date | null
  wonAt: Date | null
  status: string
  total: number
  bookedTotal: number | null
  agentName: string
}

export interface RwInvoiceRow {
  invoiceDate: Date | null
  status: string | null
  invoiceTotal: number
  receivedTotal: number
}

export interface HqInvoiceRow {
  sentAt: Date | null
  createdAt: Date
  status: string
  total: number
  amountPaid: number
  balanceDue: number
  customerName: string
}

export interface PaidObservationRow {
  observedPaidAt: Date
  invoiceTotal: number
}

export interface PaymentRow {
  receivedAt: Date
  amount: number
}

export interface OpenRwRow {
  invoiceDate: Date | null
  remainingTotal: number
  customerName: string | null
}

export interface OwnerRows {
  orders: OrderRow[]
  rwInvoices: RwInvoiceRow[]
  hqInvoices: HqInvoiceRow[]
  paidObservations: PaidObservationRow[]
  /** Earliest non-backfill observation — when collections tracking began. */
  trackingSince: Date | null
  payments: PaymentRow[]
  openRw: OpenRwRow[]
  pipeline: {
    openQuotes: { count: number; value: number }
    wonNotBooked: { count: number; value: number }
  }
  rwSyncedAt: Date | null
  /** Oldest invoice the RW mirror holds at all — how far back comparisons can reach. */
  rwEarliestInvoice: Date | null
}

// ── Output ───────────────────────────────────────────────────────────────

export interface Headline {
  key: 'won' | 'orders' | 'invoiced' | 'collected'
  label: string
  /** Dollars, or a count for `orders`. */
  value: number
  count: number
  /** Same stretch of last month; null when that window has no honest data. */
  prior: number | null
  /** Same stretch of this month last year (invoiced only). */
  lastYear: number | null
  note: string
}

export interface WeekSales {
  week: string
  /** Started before HQ held the whole book — real rows, but not the whole week's sales. */
  partialBook: boolean
  newOrders: number
  quoted: number
  quotedValue: number
  won: number
  wonValue: number
}

export interface RepSales {
  name: string
  newOrders: number
  quoted: number
  quotedValue: number
  won: number
  wonValue: number
}

export interface MonthBilling {
  month: string
  invoiced: number
  invoiceCount: number
  /** Collected so far against that month's invoices. */
  collected: number
}

export interface WeekCollected {
  week: string
  /** null = before tracking began, not zero. */
  total: number | null
  rw: number
  hq: number
}

export interface AgingBucket {
  key: string
  label: string
  amount: number
  count: number
}

export interface Owing {
  name: string
  amount: number
  count: number
  oldestDays: number
}

export interface OwnerNumbers {
  today: string
  monthLabel: string
  priorLabel: string
  headlines: Headline[]
  sales: {
    weeks: WeekSales[]
    byRep: RepSales[]
    pipeline: OwnerRows['pipeline']
    comparable: boolean
  }
  billing: { months: MonthBilling[] }
  collections: {
    weeks: WeekCollected[]
    trackingSince: string | null
    openTotal: number
    openCount: number
    aging: AgingBucket[]
    topOwing: Owing[]
  }
  rwSyncedAt: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────

const cents = (n: number) => Math.round(n * 100) / 100

export function wonValue(o: Pick<OrderRow, 'bookedTotal' | 'total'>): number {
  return o.bookedTotal ?? o.total
}

export function isWon(o: Pick<OrderRow, 'wonAt' | 'status'>): boolean {
  return !!o.wonAt && o.status !== 'CANCELLED'
}

export function countsAsInvoiced(rw: Pick<RwInvoiceRow, 'status' | 'invoiceDate'>): boolean {
  return !!rw.invoiceDate && rw.status !== 'VOID'
}

export function hqInvoiceDay(inv: Pick<HqInvoiceRow, 'status' | 'sentAt' | 'createdAt'>): string | null {
  if (inv.status === 'DRAFT' || inv.status === 'VOID') return null
  return pacificDayKey(inv.sentAt ?? inv.createdAt)
}

const MONTH_NAME = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
function monthName(monthKey: string): string {
  return MONTH_NAME.format(new Date(`${monthKey}-01T00:00:00Z`))
}

const AGING: { key: string; label: string; max: number }[] = [
  { key: '0-30', label: '0–30 days', max: 30 },
  { key: '31-60', label: '31–60 days', max: 60 },
  { key: '61-90', label: '61–90 days', max: 90 },
  { key: '90+', label: 'Over 90 days', max: Infinity },
]

export const WEEKS_SHOWN = 12
export const MONTHS_SHOWN = 13

/** How far back the query must reach for everything summarize() reads. */
export function earliestNeeded(todayKey: string): { instant: string; invoiceMonth: string } {
  const weeks = lastWeeks(todayKey, WEEKS_SHOWN)[0]
  const priorMtd = monthToDate(todayKey, 1).start
  const instant = weeks < priorMtd ? weeks : priorMtd
  // Invoiced reaches back a year for the same-month-last-year comparison, and
  // the month table shows MONTHS_SHOWN — the older of the two.
  const invoiceMonth = addMonths(todayKey.slice(0, 7), -Math.max(12, MONTHS_SHOWN - 1))
  return { instant, invoiceMonth }
}

// ── The summary ──────────────────────────────────────────────────────────

export function summarizeOwnerNumbers(rows: OwnerRows, todayKey: string): OwnerNumbers {
  const thisMtd = monthToDate(todayKey, 0)
  const priorMtd = monthToDate(todayKey, 1)
  const lastYearMtd = monthToDate(todayKey, 12)
  const salesComparable = priorMtd.start >= HQ_BOOK_START

  // Day keys once, up front.
  const orders = rows.orders.map((o) => ({
    ...o,
    createdDay: pacificDayKey(o.createdAt),
    quotedDay: o.quoteSentAt ? pacificDayKey(o.quoteSentAt) : null,
    wonDay: isWon(o) ? pacificDayKey(o.wonAt!) : null,
  }))
  const rwInvoices = rows.rwInvoices
    .filter(countsAsInvoiced)
    .map((r) => ({ ...r, day: dateOnlyKey(r.invoiceDate!) }))
  const hqInvoices = rows.hqInvoices
    .map((i) => ({ ...i, day: hqInvoiceDay(i) }))
    .filter((i): i is typeof i & { day: string } => i.day !== null)
  const observations = rows.paidObservations.map((o) => ({ ...o, day: pacificDayKey(o.observedPaidAt) }))
  const payments = rows.payments.map((p) => ({ ...p, day: pacificDayKey(p.receivedAt) }))
  const trackingSince = rows.trackingSince ? pacificDayKey(rows.trackingSince) : null

  const sumIn = <T extends { day: string }>(list: T[], r: DayRange, amount: (x: T) => number) => {
    let value = 0
    let count = 0
    for (const x of list) {
      if (!inRange(x.day, r)) continue
      value += amount(x)
      count++
    }
    return { value: cents(value), count }
  }

  // Invoiced history exists only as far back as the mirror goes. Asked of the
  // mirror, not of the rows fetched: the fetch starts on a month boundary, and
  // a first-of-month with no invoices (Labor Day) would read as "no history".
  const earliestInvoice = rows.rwEarliestInvoice ? dateOnlyKey(rows.rwEarliestInvoice) : null

  const invoicedIn = (r: DayRange) => {
    const rw = sumIn(rwInvoices, r, (x) => x.invoiceTotal)
    const hq = sumIn(hqInvoices, r, (x) => x.total)
    return { value: cents(rw.value + hq.value), count: rw.count + hq.count }
  }
  const collectedIn = (r: DayRange) => {
    const rw = sumIn(observations, r, (x) => x.invoiceTotal)
    const hq = sumIn(payments, r, (x) => x.amount)
    return { value: cents(rw.value + hq.value), count: rw.count + hq.count }
  }
  const ordersIn = (r: DayRange) => orders.filter((o) => inRange(o.createdDay, r)).length
  const wonIn = (r: DayRange) => {
    const list = orders.filter((o) => o.wonDay && inRange(o.wonDay, r))
    return { value: cents(list.reduce((s, o) => s + wonValue(o), 0)), count: list.length }
  }

  const wonNow = wonIn(thisMtd)
  const ordersNow = ordersIn(thisMtd)
  const invoicedNow = invoicedIn(thisMtd)
  const collectedNow = collectedIn(thisMtd)

  const priorLabel = `${monthName(priorMtd.start.slice(0, 7))} 1–${Number(addDays(priorMtd.end, -1).slice(8, 10))}`
  const headlines: Headline[] = [
    {
      key: 'won',
      label: 'Booked',
      value: wonNow.value,
      count: wonNow.count,
      prior: salesComparable ? wonIn(priorMtd).value : null,
      lastYear: null,
      note: 'Orders the client said yes to this month, at the booked value.',
    },
    {
      key: 'orders',
      label: 'New orders',
      value: ordersNow,
      count: ordersNow,
      prior: salesComparable ? ordersIn(priorMtd) : null,
      lastYear: null,
      note: 'Orders opened in HQ this month, quotes included. Archived duplicates and tests are left out.',
    },
    {
      key: 'invoiced',
      label: 'Invoiced',
      value: invoicedNow.value,
      count: invoicedNow.count,
      prior: invoicedIn(priorMtd).value,
      lastYear:
        earliestInvoice !== null && earliestInvoice <= lastYearMtd.start
          ? invoicedIn(lastYearMtd).value
          : null,
      note: 'RentalWorks invoices (voids excluded, credits netted) plus HQ invoices sent.',
    },
    {
      key: 'collected',
      label: 'Collected',
      value: collectedNow.value,
      count: collectedNow.count,
      prior: trackingSince !== null && trackingSince <= priorMtd.start ? collectedIn(priorMtd).value : null,
      lastYear: null,
      note: 'RentalWorks invoices seen paid off, plus payments on HQ invoices.',
    },
  ]

  // ── Sales by week and by rep ───────────────────────────────────────────
  const weekKeys = lastWeeks(todayKey, WEEKS_SHOWN)
  const weeks: WeekSales[] = weekKeys.map((week) => {
    const r = { start: week, end: addDays(week, 7) }
    const quoted = orders.filter((o) => o.quotedDay && inRange(o.quotedDay, r))
    const won = wonIn(r)
    return {
      week,
      partialBook: week < HQ_BOOK_START,
      newOrders: ordersIn(r),
      quoted: quoted.length,
      quotedValue: cents(quoted.reduce((s, o) => s + o.total, 0)),
      won: won.count,
      wonValue: won.value,
    }
  })

  const reps = new Map<string, RepSales>()
  const rep = (name: string) => {
    let r = reps.get(name)
    if (!r) {
      r = { name, newOrders: 0, quoted: 0, quotedValue: 0, won: 0, wonValue: 0 }
      reps.set(name, r)
    }
    return r
  }
  for (const o of orders) {
    if (inRange(o.createdDay, thisMtd)) rep(o.agentName).newOrders++
    if (o.quotedDay && inRange(o.quotedDay, thisMtd)) {
      const r = rep(o.agentName)
      r.quoted++
      r.quotedValue = cents(r.quotedValue + o.total)
    }
    if (o.wonDay && inRange(o.wonDay, thisMtd)) {
      const r = rep(o.agentName)
      r.won++
      r.wonValue = cents(r.wonValue + wonValue(o))
    }
  }
  const byRep = [...reps.values()].sort((a, b) => b.wonValue - a.wonValue || b.newOrders - a.newOrders)

  // ── Billing by month ───────────────────────────────────────────────────
  const months: MonthBilling[] = lastMonths(todayKey, MONTHS_SHOWN).map((month) => {
    const r = monthRange(month)
    const rw = rwInvoices.filter((x) => inRange(x.day, r))
    const hq = hqInvoices.filter((x) => inRange(x.day, r))
    return {
      month,
      invoiced: cents(rw.reduce((s, x) => s + x.invoiceTotal, 0) + hq.reduce((s, x) => s + x.total, 0)),
      invoiceCount: rw.length + hq.length,
      collected: cents(rw.reduce((s, x) => s + x.receivedTotal, 0) + hq.reduce((s, x) => s + x.amountPaid, 0)),
    }
  })

  // ── Collections by week ────────────────────────────────────────────────
  const collectedWeeks: WeekCollected[] = weekKeys.map((week) => {
    const r = { start: week, end: addDays(week, 7) }
    // A week that ENDS before tracking began has no data. The week tracking
    // began in is shown — partial, but real.
    if (trackingSince === null || r.end <= trackingSince) return { week, total: null, rw: 0, hq: 0 }
    const rw = sumIn(observations, r, (x) => x.invoiceTotal).value
    const hq = sumIn(payments, r, (x) => x.amount).value
    return { week, total: cents(rw + hq), rw, hq }
  })

  // ── Open AR ────────────────────────────────────────────────────────────
  const aging: AgingBucket[] = AGING.map((b) => ({ key: b.key, label: b.label, amount: 0, count: 0 }))
  const owing = new Map<string, Owing>()
  const addOpen = (dayKey: string | null, amount: number, name: string) => {
    if (amount <= 0) return
    const age = dayKey ? Math.max(0, daysBetween(dayKey, todayKey)) : Infinity
    const idx = AGING.findIndex((b) => age <= b.max)
    aging[idx].amount = cents(aging[idx].amount + amount)
    aging[idx].count++
    const who = name.trim() || 'Unnamed client'
    const o = owing.get(who) ?? { name: who, amount: 0, count: 0, oldestDays: 0 }
    o.amount = cents(o.amount + amount)
    o.count++
    if (Number.isFinite(age)) o.oldestDays = Math.max(o.oldestDays, age)
    owing.set(who, o)
  }
  for (const r of rows.openRw) {
    addOpen(r.invoiceDate ? dateOnlyKey(r.invoiceDate) : null, r.remainingTotal, r.customerName ?? '')
  }
  for (const i of hqInvoices) {
    if (i.status === 'PAID') continue
    addOpen(i.day, i.balanceDue, i.customerName)
  }

  return {
    today: todayKey,
    monthLabel: monthName(todayKey.slice(0, 7)),
    priorLabel,
    headlines,
    sales: { weeks, byRep, pipeline: rows.pipeline, comparable: salesComparable },
    billing: { months },
    collections: {
      weeks: collectedWeeks,
      trackingSince,
      openTotal: cents(aging.reduce((s, b) => s + b.amount, 0)),
      openCount: aging.reduce((s, b) => s + b.count, 0),
      aging,
      topOwing: [...owing.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
    },
    rwSyncedAt: rows.rwSyncedAt ? rows.rwSyncedAt.toISOString() : null,
  }
}
