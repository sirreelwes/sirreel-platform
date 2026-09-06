import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'

/**
 * A job is enough to ask for a card (Wes 2026-09-05).
 *
 * "A CCA should go out no matter what — it is often considered start
 * paperwork. If the job had been created it should go out."
 *
 * PaperworkRequest is booking-scoped (bookingId NOT NULL), and until now
 * the only thing that created an HQ-native Booking off an order was the
 * quote hold — which only fires for UNIT-TRACKED vehicle/stage lines. A
 * steel-deck-only order (BM / S260905-002, opening the yard on a Sunday
 * for Someday Studio) sent its quote, got BOOKED, and still had no
 * Booking anywhere, so the Card Authorization tile answered "No
 * reservation on this job yet — add one before requesting a card" to
 * the rep who was trying to collect start paperwork on a Saturday
 * afternoon.
 *
 * This creates the missing Booking the same way the quote hold would
 * have — one AGENT_DIRECT booking per order, window derived from the
 * order's lines, stamped back onto Order.bookingId so the client's job
 * portal shows the paperwork row too — just without waiting for a line
 * that happens to be a truck. The quote hold reuses it (it looks up
 * Order.bookingId first) and appends its items when a vehicle is added
 * later, so the two paths converge on one row instead of two.
 *
 * A job with no order at all still gets a booking: dated today, with
 * `expectsOrder` set so the incomplete-info triangle on the board asks
 * someone to attach the real one. The alternative — refusing — is the
 * behaviour this file replaces.
 */

export interface CreateAgentDirectBookingArgs {
  jobId: string | null
  companyId: string | null
  personId: string
  agentId: string
  jobName: string
  startDate: Date
  endDate: Date
  expectsOrder?: boolean
  notes?: string | null
}

/**
 * The one place an HQ-native booking is minted off an order/job. Shared
 * by the quote hold (which adds category holds to it) and the paperwork
 * path (which does not), so the two never drift on number format,
 * source, or starting status.
 */
export async function createAgentDirectBooking(
  args: CreateAgentDirectBookingArgs,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ id: string }> {
  return tx.booking.create({
    data: {
      bookingNumber: `SR-Q-${Date.now()}`,
      companyId: args.companyId,
      personId: args.personId,
      agentId: args.agentId,
      jobId: args.jobId,
      jobName: args.jobName,
      startDate: args.startDate,
      endDate: args.endDate,
      source: 'AGENT_DIRECT',
      status: 'REQUEST',
      expectsOrder: args.expectsOrder ?? false,
      notes: args.notes ?? null,
    },
    select: { id: true },
  })
}

/** Today's calendar day at the yard, as the UTC-midnight Date a @db.Date column stores. */
function pacificTodayAsDbDate(now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return new Date(`${ymd}T00:00:00Z`)
}

export type EnsurePaperworkBookingResult =
  | { ok: true; bookingId: string; created: boolean }
  | { ok: false; error: string }

/**
 * The booking this job's paperwork should hang off — the newest live one,
 * or a fresh AGENT_DIRECT booking derived from the job's newest live
 * order when none exists.
 *
 * Send-path only: it WRITES when it has to. Previews use
 * `resolveCardAuthBookingId`, which never creates anything.
 */
export async function ensureJobPaperworkBooking(jobId: string): Promise<EnsurePaperworkBookingResult> {
  const live = await prisma.booking.findFirst({
    where: { jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (live) return { ok: true, bookingId: live.id, created: false }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      name: true,
      companyId: true,
      agentId: true,
      jobContacts: { select: { role: true, isPrimary: true, personId: true } },
      orders: {
        where: { status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          bookingId: true,
          companyId: true,
          agentId: true,
          booking: { select: { id: true, status: true } },
          lineItems: { select: { pickupDate: true, returnDate: true } },
        },
      },
    },
  })
  if (!job) return { ok: false, error: 'job not found' }

  const order = job.orders[0] ?? null

  // The order's own booking came back CANCELLED (a lost quote, since
  // revived or re-quoted). Bring it back the way the quote hold does
  // rather than leaving the job with two AGENT_DIRECT rows.
  if (order?.booking && order.booking.status === 'CANCELLED') {
    await prisma.booking.update({ where: { id: order.booking.id }, data: { status: 'REQUEST' } })
    return { ok: true, bookingId: order.booking.id, created: false }
  }

  const contact = pickPrimaryContact(job.jobContacts)
  const personId =
    contact?.personId ??
    (job.companyId
      ? await prisma.person
          .findFirst({
            where: { affiliations: { some: { companyId: job.companyId, isCurrent: true } } },
            select: { id: true },
          })
          .then((p) => p?.id ?? null)
      : null)
  if (!personId) {
    return { ok: false, error: 'No contact on this job yet — add the person the card request should go to.' }
  }

  const agentId = order?.agentId ?? job.agentId
  if (!agentId) return { ok: false, error: 'No agent on this job — assign one before requesting a card.' }

  const window = order ? deriveOrderWindow({ lineItems: order.lineItems }) : { start: null, end: null }
  const today = pacificTodayAsDbDate()
  const startDate = window.start ?? window.end ?? today
  const endDate = window.end ?? startDate

  const created = await createAgentDirectBooking({
    jobId: job.id,
    companyId: order?.companyId ?? job.companyId ?? null,
    personId,
    agentId,
    jobName: job.name,
    startDate,
    endDate,
    expectsOrder: !order,
    notes: order
      ? null
      : 'Created for start paperwork (card authorization) before any order existed — attach the real order.',
  })

  if (order && !order.bookingId) {
    await prisma.order.update({ where: { id: order.id }, data: { bookingId: created.id } })
  }

  await prisma.auditLog.create({
    data: {
      action: 'booking.created_for_paperwork',
      entityType: 'Booking',
      entityId: created.id,
      newValues: {
        jobId: job.id,
        orderId: order?.id ?? null,
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        reason: order ? 'order-without-booking' : 'job-without-order',
      },
    },
  })

  return { ok: true, bookingId: created.id, created: true }
}
