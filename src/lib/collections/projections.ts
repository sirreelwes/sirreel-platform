/**
 * Weekly collections projection — what should land, and when.
 *
 * Ana, 2026-09-14: *"Do we have a tool to create weekly collections
 * projections? I can go off RentalWorks for anything made there, but we'll
 * need something going forward."*
 *
 * ── Why this is not just "sum the open invoices" ──────────────────────────
 *
 * SirReel has no Net terms: every invoice is due on receipt, so due dates
 * carry no forecasting information at all — bucketing by `dueDate` would pile
 * the entire receivable into "this week", every week, forever. What predicts
 * arrival is how long clients actually take to pay.
 *
 * ── HQ CANNOT MEASURE THAT YET, and this file refuses to pretend ──────────
 *
 * The obvious move is to measure the median days from invoice to payment.
 * Measured on 2026-09-14, both available sources are unusable:
 *
 *   HQ invoices          THREE have ever been paid, all at 1 day — Ana sends
 *                        the invoice and charges the card on file minutes
 *                        later. A sample of three cannot forecast anything.
 *   RW paid-observations 176 rows since tracking began on 2026-08-19, 157 of
 *                        them reading a 1-day lag. That is not fast payment,
 *                        it is an artifact: the mirror sees an invoice and
 *                        its zero balance at the same time. The 2,971
 *                        backfilled rows read a 191-day median, which is just
 *                        how old each invoice was when tracking started.
 *
 * So the payment lag here is a STATED ASSUMPTION (`lagDays`, default 14), set
 * by whoever is reading the forecast, and the UI labels it as one. A number
 * derived from those samples would have looked measured and been noise — and
 * a projection whose central parameter is noise is worse than no projection,
 * because it gets believed.
 *
 * `measuredLag` is still reported so the assumption can be replaced the day
 * HQ-native invoicing has real history behind it. That is the only thing
 * standing between this and a genuinely measured forecast.
 *
 * ── The billing line is the solid one ─────────────────────────────────────
 *
 * Each week also carries `billing`: what is due to be INVOICED that week,
 * placed by its billing date and untouched by the lag assumption. HQ knows
 * that cold — an order comes back, Ana bills it the next day — so it is the
 * number to trust when the payment timing is a guess.
 *
 * ── Three sources, in descending order of certainty ───────────────────────
 *
 *   INVOICED   the client has the bill. Expected = sent + lagDays.
 *   TO_BILL    came back, not yet invoiced (the billing queue's own rows).
 *              Billed on the queue's own date; expected = that + lagDays.
 *   UPCOMING   committed and due back inside the horizon (booked, loaded,
 *              on the job, or approved). Billed the day after it comes back
 *              (Ana's rule); expected = that + lagDays.
 *   QUOTED     a quote is out and the client has not confirmed. Reported in
 *              its own column and EXCLUDED from every total.
 *
 * That last split is not fussiness. Measured on 2026-09-14, the forward book
 * for the next six weeks was 21 orders, and all but three of them sat in
 * QUOTE_SENT / DRAFT — this yard confirms late. A forecast that required
 * BOOKED showed almost nothing past next week and read as a dead month; one
 * that quietly counted quotes as cash would have forecast money nobody has
 * agreed to pay. So quotes are shown, labelled, and never added in.
 *
 * Each week reports the three separately and never blends them into one
 * number, because they are not equally likely: an UPCOMING week that looks
 * strong is a forecast about orders that have not come back yet.
 *
 * ── Overdue is its own bucket, never smeared forward ──────────────────────
 *
 * An invoice whose expected date has already passed does NOT get quietly
 * rescheduled into next week. It sits in `overdue`, which is the honest
 * statement: this money was expected and did not arrive, and nothing about
 * the calendar makes it more likely to arrive next Tuesday. Smearing it
 * forward is how a projection becomes a wish — every week inherits last
 * week's misses and always looks fine.
 *
 * ── What it cannot see ────────────────────────────────────────────────────
 *
 * Deposits, holds and anything invoiced entirely inside RentalWorks after
 * the mirror's last sync. `syncedAt` is reported so a stale mirror is
 * visible rather than read as a quiet week.
 */

import { prisma } from '@/lib/prisma'
import { nonCollectibleInvoiceIds, collectibleWhere } from '@/lib/collections/collectible'
import { billingQueue, pacificYmdOf } from '@/lib/collections/billingQueue'

/** How far ahead the forecast runs. */
export const HORIZON_WEEKS = 6
/** How far back the lag is measured. */
const LAG_WINDOW_DAYS = 180
/** The default payment-lag ASSUMPTION, in days. Not measured — see the header.
 *  Callers may override it; the UI exposes it as a control and says so. */
export const DEFAULT_LAG_DAYS = 14
/** Below this many settled invoices a measured median is noise. */
const MIN_SAMPLES = 20

export type ProjectionSource = 'INVOICED' | 'TO_BILL' | 'UPCOMING' | 'QUOTED'

export interface ProjectionItem {
  source: ProjectionSource
  label: string
  sublabel: string | null
  amount: number
  /** Pacific day the money is expected — billing day + the lag assumption. */
  expectedYmd: string
  /** Pacific day the INVOICE goes out. Null for INVOICED items, which are
   *  already billed. Bucketed separately because HQ actually knows it. */
  billYmd: string | null
  /** Where the underlying figure came from — 'HQ' or 'RW'. */
  pipe: 'HQ' | 'RW'
  href: string | null
}

export interface ProjectionWeek {
  /** Monday of the week, Pacific, YYYY-MM-DD. */
  startYmd: string
  endYmd: string
  label: string
  invoiced: number
  toBill: number
  upcoming: number
  /** Quotes out for this week. NOT in `total` — nobody has said yes. */
  quoted: number
  total: number
  /** Value due to be INVOICED this week, placed by its billing date and
   *  independent of the lag assumption. The high-confidence line. */
  billing: number
  items: ProjectionItem[]
}

export interface CollectionsProjection {
  generatedAt: string
  todayYmd: string
  lag: {
    /** The assumption in force for this run. */
    assumedDays: number
    /** What history there is, reported so the assumption can be retired one
     *  day — never silently used. `usable` is false while the samples are too
     *  few or too obviously artifactual to forecast from. */
    measured: {
      hqMedianDays: number | null
      hqSamples: number
      rwMedianDays: number | null
      rwSamples: number
      usable: boolean
      why: string
    }
  }
  weeks: ProjectionWeek[]
  overdue: { amount: number; count: number; items: ProjectionItem[] }
  /** What actually landed in each of the last 8 weeks — the projection is
   *  meaningless without something to read it against. */
  actuals: { startYmd: string; label: string; amount: number }[]
  rwSyncedAt: string | null
  totals: { invoiced: number; toBill: number; upcoming: number; quoted: number; all: number }
}

const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100

/** Median of a non-empty list. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** The Monday on or before `ymd`, as YYYY-MM-DD. Pure calendar arithmetic. */
export function weekStartYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`)
  const dow = d.getUTCDay() // 0 Sun … 6 Sat
  const back = dow === 0 ? 6 : dow - 1
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function weekLabel(startYmd: string, todayWeek: string): string {
  if (startYmd === todayWeek) return 'This week'
  if (startYmd === addDaysYmd(todayWeek, 7)) return 'Next week'
  const d = new Date(`${startYmd}T12:00:00.000Z`)
  return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
}

export async function buildCollectionsProjection(
  now: Date = new Date(),
  opts: { lagDays?: number } = {},
): Promise<CollectionsProjection> {
  const lagDays =
    Number.isFinite(opts.lagDays) && (opts.lagDays as number) >= 0 && (opts.lagDays as number) <= 180
      ? Math.round(opts.lagDays as number)
      : DEFAULT_LAG_DAYS
  const todayYmd = pacificYmdOf(now)
  const thisWeek = weekStartYmd(todayYmd)
  const lagSince = new Date(now.getTime() - LAG_WINDOW_DAYS * 86_400_000)

  const [hqPaid, rwObserved, openHq, excludedRwIds, queue, rwSync] = await Promise.all([
    prisma.invoice.findMany({
      where: { paidAt: { gte: lagSince }, sentAt: { not: null }, NOT: { status: 'VOID' } },
      select: { sentAt: true, paidAt: true },
    }),
    prisma.rwInvoicePaidObservation.findMany({
      where: { observedPaidAt: { gte: lagSince }, preTracking: false, invoiceDate: { not: null } },
      select: { invoiceDate: true, observedPaidAt: true },
    }),
    prisma.invoice.findMany({
      where: { status: { in: ['SENT', 'PARTIAL'] }, balanceDue: { gt: 0 } },
      select: {
        id: true,
        invoiceNumber: true,
        balanceDue: true,
        sentAt: true,
        type: true,
        order: {
          select: { id: true, orderNumber: true, job: { select: { name: true, company: { select: { name: true } } } } },
        },
      },
    }),
    nonCollectibleInvoiceIds(),
    billingQueue(),
    prisma.rwInvoice.aggregate({ _max: { syncedAt: true } }),
  ])

  const openRw = await prisma.rwInvoice.findMany({
    where: collectibleWhere(excludedRwIds),
    select: {
      rwInvoiceId: true,
      invoiceNumber: true,
      customerName: true,
      remainingTotal: true,
      invoiceDate: true,
    },
  })

  // ── Measured lag ────────────────────────────────────────────────────
  const hqLags = hqPaid
    .filter((i) => i.sentAt && i.paidAt)
    .map((i) => Math.max(0, Math.round((i.paidAt!.getTime() - i.sentAt!.getTime()) / 86_400_000)))
  const rwLags = rwObserved
    .filter((o) => o.invoiceDate)
    .map((o) => Math.max(0, Math.round((o.observedPaidAt.getTime() - o.invoiceDate!.getTime()) / 86_400_000)))

  // Reported, NOT used — see the header. Both pipes stay on the assumption
  // until the history is real; flipping this on is a deliberate future edit,
  // not something that happens the moment a sample count crosses a line.
  const hqMedianDays = hqLags.length ? median(hqLags) : null
  const rwMedianDays = rwLags.length ? median(rwLags) : null
  const measuredUsable = hqLags.length >= MIN_SAMPLES
  const hqDays = lagDays
  const rwDays = lagDays

  const items: ProjectionItem[] = []

  // ── INVOICED — the client has the bill ──────────────────────────────
  for (const inv of openHq) {
    const sentYmd = inv.sentAt ? pacificYmdOf(inv.sentAt) : todayYmd
    items.push({
      source: 'INVOICED',
      label: inv.invoiceNumber,
      sublabel:
        inv.order?.job?.company?.name ?? inv.order?.job?.name ?? inv.order?.orderNumber ?? null,
      amount: money(inv.balanceDue),
      expectedYmd: addDaysYmd(sentYmd, hqDays),
      billYmd: null,
      pipe: 'HQ',
      href: inv.order?.id ? `/orders/${inv.order.id}#invoices` : null,
    })
  }
  for (const rw of openRw) {
    const dateYmd = rw.invoiceDate ? pacificYmdOf(rw.invoiceDate) : todayYmd
    items.push({
      source: 'INVOICED',
      label: rw.invoiceNumber ?? 'RW invoice',
      sublabel: rw.customerName,
      amount: money(rw.remainingTotal),
      expectedYmd: addDaysYmd(dateYmd, rwDays),
      billYmd: null,
      pipe: 'RW',
      href: '/collections',
    })
  }

  // ── TO_BILL — back, not yet invoiced. The queue already decided WHEN
  //    each one is due to be billed; this only adds the payment lag.
  for (const lane of [queue.due, queue.tomorrow, queue.snoozed]) {
    for (const row of lane) {
      if (row.amount <= 0) continue
      items.push({
        source: 'TO_BILL',
        label: row.orderNumber,
        sublabel: row.companyName ?? row.jobName,
        amount: money(row.amount),
        expectedYmd: addDaysYmd(row.billOnYmd, hqDays),
        billYmd: row.billOnYmd,
        pipe: 'HQ',
        href: `/jobs/${row.jobId}`,
      })
    }
  }

  // ── UPCOMING — still out, due back inside the horizon ───────────────
  const horizonEnd = addDaysYmd(thisWeek, HORIZON_WEEKS * 7 - 1)
  const upcoming = await prisma.order.findMany({
    where: {
      // APPROVED counts as committed — the client has said yes; the order
      // just has not been walked to BOOKED yet. DRAFT never counts: nobody
      // outside this building has seen it.
      status: { in: ['BOOKED', 'LOADED_READY', 'ON_JOB', 'APPROVED', 'QUOTE_SENT'] },
      endDate: { gte: new Date(`${todayYmd}T00:00:00.000Z`), lte: new Date(`${horizonEnd}T23:59:59.999Z`) },
      invoices: { none: { NOT: { status: 'VOID' } } },
    },
    select: {
      id: true,
      orderNumber: true,
      endDate: true,
      total: true,
      bookedTotal: true,
      status: true,
      job: { select: { id: true, name: true, company: { select: { name: true } } } },
    },
  })
  for (const o of upcoming) {
    if (!o.endDate) continue
    const amount = money(o.bookedTotal ?? o.total)
    if (amount <= 0) continue
    const billYmd = addDaysYmd(pacificYmdOf(o.endDate), 1)
    items.push({
      source: o.status === 'QUOTE_SENT' ? 'QUOTED' : 'UPCOMING',
      label: o.orderNumber,
      sublabel: o.job?.company?.name ?? o.job?.name ?? null,
      amount,
      // Ana's own rule: bill the day after it comes back.
      expectedYmd: addDaysYmd(billYmd, hqDays),
      billYmd,
      pipe: 'HQ',
      href: o.job?.id ? `/jobs/${o.job.id}` : null,
    })
  }

  // ── Bucket ──────────────────────────────────────────────────────────
  const weeks: ProjectionWeek[] = []
  for (let i = 0; i < HORIZON_WEEKS; i++) {
    const startYmd = addDaysYmd(thisWeek, i * 7)
    weeks.push({
      startYmd,
      endYmd: addDaysYmd(startYmd, 6),
      label: weekLabel(startYmd, thisWeek),
      invoiced: 0,
      toBill: 0,
      upcoming: 0,
      quoted: 0,
      total: 0,
      billing: 0,
      items: [],
    })
  }
  const byStart = new Map(weeks.map((w) => [w.startYmd, w]))
  const overdue: ProjectionItem[] = []
  const lastStart = weeks[weeks.length - 1].startYmd

  for (const it of items) {
    // The billing line is bucketed on its own date and is NOT affected by
    // the lag assumption — a week's billings are a fact about the order
    // book, whatever anyone assumes about how fast clients pay.
    if (it.billYmd && it.source !== 'QUOTED') {
      const bw = byStart.get(weekStartYmd(it.billYmd))
      if (bw) bw.billing = money(bw.billing + it.amount)
    }
    // Expected in the past = overdue, never rescheduled forward. A QUOTE
    // cannot be overdue — nobody owes it — so a stale one is simply dropped.
    if (it.expectedYmd < todayYmd) {
      if (it.source !== 'QUOTED') overdue.push(it)
      continue
    }
    const ws = weekStartYmd(it.expectedYmd)
    // Beyond the horizon is dropped rather than crammed into the last week,
    // which would make week six look like a spike that isn't there.
    if (ws > lastStart) continue
    const w = byStart.get(ws)
    if (!w) continue
    w.items.push(it)
    if (it.source === 'INVOICED') w.invoiced = money(w.invoiced + it.amount)
    else if (it.source === 'TO_BILL') w.toBill = money(w.toBill + it.amount)
    else if (it.source === 'QUOTED') w.quoted = money(w.quoted + it.amount)
    else w.upcoming = money(w.upcoming + it.amount)
    // Quotes are deliberately absent from the total.
    w.total = money(w.invoiced + w.toBill + w.upcoming)
  }
  for (const w of weeks) w.items.sort((a, b) => b.amount - a.amount)

  // ── Actuals, last 8 weeks — what the forecast is read against ───────
  const actualsSince = new Date(`${addDaysYmd(thisWeek, -7 * 8)}T00:00:00.000Z`)
  const [payments, charges, finals] = await Promise.all([
    prisma.payment.findMany({
      where: { receivedAt: { gte: actualsSince }, voidedAt: null, NOT: { status: 'FAILED' } },
      select: { receivedAt: true, amount: true },
    }),
    prisma.rwCollectionCharge.findMany({
      where: { chargedAt: { gte: actualsSince }, status: 'APPROVED', reversedAt: null },
      select: { chargedAt: true, amount: true },
    }),
    prisma.jobFinalInvoice.findMany({
      where: { collectedAt: { gte: actualsSince }, NOT: { collectedVia: 'CARD' } },
      select: { collectedAt: true, amount: true },
    }),
  ])
  const actualByWeek = new Map<string, number>()
  const addActual = (d: Date, amt: unknown) => {
    const ws = weekStartYmd(pacificYmdOf(d))
    actualByWeek.set(ws, money((actualByWeek.get(ws) ?? 0) + money(amt)))
  }
  for (const p of payments) addActual(p.receivedAt, p.amount)
  for (const c of charges) addActual(c.chargedAt, c.amount)
  for (const f of finals) if (f.collectedAt) addActual(f.collectedAt, f.amount)

  const actuals = Array.from({ length: 8 }, (_, i) => {
    const startYmd = addDaysYmd(thisWeek, -7 * (8 - i))
    return {
      startYmd,
      label: new Date(`${startYmd}T12:00:00.000Z`).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', timeZone: 'UTC',
      }),
      amount: actualByWeek.get(startYmd) ?? 0,
    }
  })

  const pick = (w: ProjectionWeek, s: ProjectionSource) =>
    s === 'INVOICED' ? w.invoiced : s === 'TO_BILL' ? w.toBill : s === 'QUOTED' ? w.quoted : w.upcoming
  const sum = (s: ProjectionSource) => money(weeks.reduce((n, w) => n + pick(w, s), 0))

  return {
    generatedAt: now.toISOString(),
    todayYmd,
    lag: {
      assumedDays: lagDays,
      measured: {
        hqMedianDays,
        hqSamples: hqLags.length,
        rwMedianDays,
        rwSamples: rwLags.length,
        usable: measuredUsable,
        why: measuredUsable
          ? 'enough settled HQ invoices to measure'
          : `only ${hqLags.length} HQ invoice${hqLags.length === 1 ? '' : 's'} have been paid since HQ-native billing started, and the RentalWorks paid-observations measure when the mirror noticed a zero balance, not when the client paid`,
      },
    },
    weeks,
    overdue: {
      amount: money(overdue.reduce((n, i) => n + i.amount, 0)),
      count: overdue.length,
      items: overdue.sort((a, b) => b.amount - a.amount).slice(0, 50),
    },
    actuals,
    rwSyncedAt: rwSync._max.syncedAt?.toISOString() ?? null,
    totals: {
      invoiced: sum('INVOICED'),
      toBill: sum('TO_BILL'),
      upcoming: sum('UPCOMING'),
      quoted: sum('QUOTED'),
      all: money(weeks.reduce((n, w) => n + w.total, 0)),
    },
  }
}
