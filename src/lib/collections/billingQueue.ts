/**
 * The billing queue — "what do I invoice today?"
 *
 * Ana, 2026-09-08: "I'm going to need the collections dashboard to give me a
 * list of orders that are to be billed each day. Regardless of L&D, I always
 * bill out the day after check-in. Therefore, if an order came back on 9/8
 * (today), then I would want it queued up on my dashboard on 9/9. It will
 * also be easier for me to take sending HQ invoices off of sales' plate."
 *
 * Two things follow from that, and they are the whole design:
 *
 *   1. The queue is DERIVED, not a worklist someone has to file into. An
 *      order that came back and has no sent invoice is due to be billed the
 *      next day whether or not anybody remembered to hand it over. The
 *      RW-era JobFinalInvoice hand-off is the opposite arrangement — sales
 *      uploads a number and collections chases it — and its failure mode is
 *      silence: an order nobody hands over is an order nobody bills.
 *
 *   2. L&D is NOT a gate. Ana bills the rental the day after check-in and
 *      settles damages separately. So a short count on the check-in sheet
 *      shows on the row as a NOTE and changes nothing about when the order
 *      is due — deliberately, because "wait for the damage number" is what
 *      used to hold invoices for weeks.
 *
 * WHEN DID IT COME BACK? Four things can say so, and HQ is mid-migration, so
 * a real order may have any subset of them:
 *
 *   CHECK_IN_REPORT  the yard's inbound sheet was typed in (the strongest
 *                    statement anyone makes — a human counted it)
 *   GEAR_CHECKED_IN  the pick list reached CHECKED_IN
 *   JOB_RETURNED     Job.returnedAt — the "✓ returned" button, or whatever
 *                    settleJobReturn stamped
 *   DUE_BACK         nothing was filed at all; the order's own end date has
 *                    passed
 *
 * `basis` reports the STRONGEST one present, so the row can say whether a
 * human confirmed the return or the queue is going on the calendar alone.
 * The DAY it came back is the EARLIEST any of them gives, because a sheet
 * typed in three days late must not delay the bill by three days — the
 * transcription date is not the return date.
 *
 * DUE_BACK is in the list on purpose, and it is the one that will be wrong
 * occasionally (a truck stays out, nobody moves the date). That is the right
 * way to be wrong here: an order that is still out shows up a day early and
 * Ana snoozes it, versus an order that quietly never gets billed. The row
 * says which basis it is on, so a DUE_BACK row is never mistaken for a
 * confirmed return.
 */

import { prisma } from '@/lib/prisma'

/** How far back the queue reaches. Anything returned longer ago than this is
 *  not a daily-billing problem any more — it is an aging problem, and it has
 *  its own desk (/collections/aging-review). Reported as a count so the
 *  cut-off is never silent. */
export const BILLING_LOOKBACK_DAYS = 120

/** Order statuses that can still need an invoice. INVOICED and CLOSED are
 *  billed by definition; CANCELLED never will be. The pre-booked three are
 *  IN — an order routinely goes out on paper as a quote and only catches up
 *  afterwards (see REPORTABLE_ORDER_STATUSES in checkReports.ts), and Ana
 *  needs to see one that came back unbooked rather than have it hide until
 *  someone books it. */
const BILLABLE_STATUSES = [
  'DRAFT', 'QUOTE_SENT', 'APPROVED',
  'BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK',
] as const

export type CheckInBasis = 'CHECK_IN_REPORT' | 'GEAR_CHECKED_IN' | 'JOB_RETURNED' | 'DUE_BACK'

export interface BillingQueueRow {
  orderId: string
  orderNumber: string
  status: string
  jobId: string
  jobName: string
  jobCode: string | null
  companyId: string | null
  companyName: string | null
  agentName: string | null
  startDate: string | null
  endDate: string | null
  /** The Pacific day the order came back — earliest day any signal gives. */
  returnedYmd: string
  /** The Pacific day it is due to be billed: the day AFTER it came back. */
  billOnYmd: string
  /** Strongest evidence for the return. DUE_BACK means nobody filed
   *  anything and this is the calendar talking. */
  basis: CheckInBasis
  /** Days the row has been due. 0 = due today, 3 = three days late. */
  overdueDays: number
  /** What the client is going to be billed: the booked snapshot when there
   *  is one, else the order's working total. */
  amount: number
  /** Null until the order has been booked — and until then it CANNOT be
   *  invoiced (generateRentalInvoice requires the booked snapshot). This is
   *  what `blocked` reports. */
  bookedTotal: number | null
  /** Why this row cannot be actioned yet, when it can't. */
  blocked: 'NOT_BOOKED' | null
  /** A live RENTAL invoice that exists but has NOT gone to the client. The
   *  row stays in the queue until it is sent — generating the document is
   *  not billing anyone. */
  draftInvoice: {
    id: string
    invoiceNumber: string
    status: string
    total: number
    /** Sent to the client for review (the pre-invoice round), which is not
     *  the same as billed. */
    preSentAt: string | null
    clientApprovedAt: string | null
    clientChangeRequestedAt: string | null
  } | null
  /** The inbound sheet covered only part of the order — the rest is still
   *  out. Ana bills anyway (her rule), but she should know. */
  partialCheckIn: boolean
  /** Lines the inbound sheet recorded as differing from what went out —
   *  the shortfall that becomes an L&D conversation. NOT a hold: shown
   *  because it is what the client will ask about, not to gate the bill. */
  checkInDifferences: number
  /** An RW-era final invoice already exists on this job, so this order may
   *  well have been billed out of RentalWorks. Evidence, not a verdict —
   *  JobFinalInvoice is per-JOB and this queue is per-ORDER. */
  finalInvoiceOnJob: { status: string; uploadedAt: string } | null
  /** Ana's standing ruling, when there is one. */
  mark: { status: string; snoozedUntil: string | null; reason: string | null } | null
}

export interface BillingQueue {
  /** Pacific today, so the client renders the same day the server decided. */
  today: string
  /** Due now — billOn is today or earlier. Oldest first: the point of the
   *  queue is that nothing sits. */
  due: BillingQueueRow[]
  /** Came back TODAY, so it bills tomorrow. Ana's own example — a heads-up
   *  lane, not work. */
  tomorrow: BillingQueueRow[]
  /** Snoozed to a future day, shown so a snooze can't swallow an order. */
  snoozed: BillingQueueRow[]
  stats: {
    dueCount: number
    dueTotal: number
    /** Oldest row's overdueDays. 0 when everything is same-day. */
    oldestDays: number
    /** Due rows that cannot be invoiced because nobody booked the order. */
    notBookedCount: number
    /** Due rows whose only evidence is the calendar. */
    dueBackOnlyCount: number
    /** Rows dropped for being older than the lookback. Counted rather than
     *  hidden — a truncated list that gives no sign it was truncated is how
     *  the /jobs list lost 50 rows. */
    olderSuppressed: number
  }
}

/** A Date's Pacific calendar day, as YYYY-MM-DD. */
export function pacificYmdOf(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Pacific today (or today + offset) as YYYY-MM-DD. */
export function pacificToday(offsetDays = 0): string {
  return pacificYmdOf(new Date(Date.now() + offsetDays * 86_400_000))
}

/** The calendar day after `ymd`. Pure string/UTC arithmetic — no timezone
 *  is involved in "the next day on a calendar". */
export function nextYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`, both Pacific ymd. Negative when `to` is
 *  earlier. */
export function daysBetweenYmd(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`)
  const b = Date.parse(`${to}T00:00:00.000Z`)
  return Math.round((b - a) / 86_400_000)
}

/** @db.Date columns are stored at UTC midnight — read them in UTC or they
 *  print the previous day west of Greenwich. */
const dbDateYmd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)

export async function billingQueue(): Promise<BillingQueue> {
  const today = pacificToday()
  const cutoffYmd = pacificToday(-BILLING_LOOKBACK_DAYS)
  const cutoff = new Date(`${cutoffYmd}T00:00:00.000Z`)

  const orders = await prisma.order.findMany({
    where: {
      status: { in: [...BILLABLE_STATUSES] },
      // A lost quote is not on a truck, and it lives on the other status
      // axis — same clause the check-report list needs.
      quoteStatus: { not: 'LOST' },
      archivedAt: null,
      // At least one thing has to say the order came back, or is due to.
      // Filtering here rather than in memory is what keeps this off a full
      // scan of every live order.
      OR: [
        { checkReports: { some: { edge: 'IN' } } },
        { pickList: { checkedInAt: { not: null } } },
        { job: { returnedAt: { gte: cutoff } } },
        { endDate: { gte: cutoff, lte: new Date(`${today}T00:00:00.000Z`) } },
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      startDate: true,
      endDate: true,
      total: true,
      bookedTotal: true,
      jobId: true,
      job: {
        select: {
          id: true,
          name: true,
          jobCode: true,
          returnedAt: true,
          company: { select: { id: true, name: true } },
          finalInvoices: {
            where: { status: { not: 'VOID' } },
            orderBy: { uploadedAt: 'desc' },
            take: 1,
            select: { status: true, uploadedAt: true },
          },
        },
      },
      agent: { select: { name: true } },
      pickList: { select: { checkedInAt: true } },
      checkReports: {
        where: { edge: 'IN' },
        select: {
          submittedAt: true,
          partial: true,
          lines: { where: { NOT: { change: 'NONE' } }, select: { id: true } },
        },
      },
      // Every live invoice on the order. A SENT rental invoice takes the
      // order out of the queue; an unsent one keeps it in and says so.
      invoices: {
        where: { status: { not: 'VOID' }, type: 'RENTAL' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          sentAt: true,
          preSentAt: true,
          clientApprovedAt: true,
          clientChangeRequestedAt: true,
        },
      },
      billingMark: {
        select: { status: true, snoozedUntil: true, reason: true },
      },
    },
  })

  const due: BillingQueueRow[] = []
  const tomorrow: BillingQueueRow[] = []
  const snoozed: BillingQueueRow[] = []
  let olderSuppressed = 0

  for (const o of orders) {
    // Already billed: the client has the document. Nothing else about the
    // order matters at that point.
    if (o.invoices.some((i) => i.sentAt)) continue

    // A dismissal takes the order off this desk entirely — it is being
    // billed somewhere else, or not at all. Cleared from the order's own
    // row when someone puts it back.
    if (o.billingMark?.status === 'DISMISSED') continue

    const report = o.checkReports[0] ?? null
    const endYmd = dbDateYmd(o.endDate)

    // Every day any signal offers, strongest first. A PARTIAL inbound sheet
    // is not a return — half the gear is still out — so it contributes no
    // day, only the flag further down.
    const signals: Array<{ ymd: string; basis: CheckInBasis }> = []
    if (report && !report.partial) {
      signals.push({ ymd: pacificYmdOf(report.submittedAt), basis: 'CHECK_IN_REPORT' })
    }
    if (o.pickList?.checkedInAt) {
      signals.push({ ymd: pacificYmdOf(o.pickList.checkedInAt), basis: 'GEAR_CHECKED_IN' })
    }
    if (o.job?.returnedAt) {
      signals.push({ ymd: pacificYmdOf(o.job.returnedAt), basis: 'JOB_RETURNED' })
    }
    // The calendar only speaks once the day has passed. A future end date
    // means the order is still out.
    if (endYmd && endYmd <= today) signals.push({ ymd: endYmd, basis: 'DUE_BACK' })

    if (signals.length === 0) continue

    // Strongest evidence for WHETHER it is back; earliest day for WHEN.
    const basis = signals[0].basis
    const returnedYmd = signals.reduce((a, s) => (s.ymd < a ? s.ymd : a), signals[0].ymd)

    if (returnedYmd < cutoffYmd) {
      olderSuppressed++
      continue
    }

    const billOnYmd = nextYmd(returnedYmd)
    const overdueDays = daysBetweenYmd(billOnYmd, today)
    const draft = o.invoices[0] ?? null
    const bookedTotal = o.bookedTotal === null ? null : Number(o.bookedTotal)
    const fin = o.job?.finalInvoices[0] ?? null

    const row: BillingQueueRow = {
      orderId: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      jobId: o.jobId,
      jobName: o.job?.name ?? 'Unnamed job',
      jobCode: o.job?.jobCode ?? null,
      companyId: o.job?.company?.id ?? null,
      companyName: o.job?.company?.name ?? null,
      agentName: o.agent?.name ?? null,
      startDate: dbDateYmd(o.startDate),
      endDate: endYmd,
      returnedYmd,
      billOnYmd,
      basis,
      overdueDays,
      amount: bookedTotal ?? Number(o.total),
      bookedTotal,
      blocked: bookedTotal === null ? 'NOT_BOOKED' : null,
      draftInvoice: draft
        ? {
            id: draft.id,
            invoiceNumber: draft.invoiceNumber,
            status: draft.status,
            total: Number(draft.total),
            preSentAt: draft.preSentAt?.toISOString() ?? null,
            clientApprovedAt: draft.clientApprovedAt?.toISOString() ?? null,
            clientChangeRequestedAt: draft.clientChangeRequestedAt?.toISOString() ?? null,
          }
        : null,
      partialCheckIn: report?.partial ?? false,
      checkInDifferences: report?.lines.length ?? 0,
      finalInvoiceOnJob: fin
        ? { status: fin.status, uploadedAt: fin.uploadedAt.toISOString() }
        : null,
      mark: o.billingMark
        ? {
            status: o.billingMark.status,
            snoozedUntil: dbDateYmd(o.billingMark.snoozedUntil),
            reason: o.billingMark.reason,
          }
        : null,
    }

    if (o.billingMark?.status === 'SNOOZED') {
      const until = dbDateYmd(o.billingMark.snoozedUntil)
      if (until && until > today) {
        snoozed.push(row)
        continue
      }
      // A lapsed snooze is just a due row again — with the note still on it.
    }

    if (overdueDays >= 0) due.push(row)
    else if (billOnYmd === nextYmd(today)) tomorrow.push(row)
    // Anything further out is still on a truck; it will arrive here on its
    // own day.
  }

  // Oldest first. Same-day rows fall back to order number so the list does
  // not reshuffle between refreshes.
  due.sort((a, b) => b.overdueDays - a.overdueDays || a.orderNumber.localeCompare(b.orderNumber))
  tomorrow.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber))
  snoozed.sort((a, b) => (a.mark?.snoozedUntil ?? '').localeCompare(b.mark?.snoozedUntil ?? ''))

  return {
    today,
    due,
    tomorrow,
    snoozed,
    stats: {
      dueCount: due.length,
      dueTotal: due.reduce((s, r) => s + r.amount, 0),
      oldestDays: due.length ? Math.max(...due.map((r) => r.overdueDays)) : 0,
      notBookedCount: due.filter((r) => r.blocked === 'NOT_BOOKED').length,
      dueBackOnlyCount: due.filter((r) => r.basis === 'DUE_BACK').length,
      olderSuppressed,
    },
  }
}
