/**
 * The partner's two later emails in a sub-rental's life — after the
 * estimate note (quote sent) and the hold request (client said hold):
 *
 *   BOOKED    → "It's a go"   the client booked; the unit is firm
 *   CANCELLED → "Cancelled"   the client pulled out; the unit is released
 *
 * Wes 2026-09-06: "The please hold happens when we quote a client and that
 * client replies to us that we want to hold it. The next email would be —
 * the client has booked — this job looks like a go!" and "We have a 24 hr
 * cancellation policy with clients typically."
 *
 * Same scope rule as requestOnApproval: rows bound to the ORDER, plus
 * job-bound rows with no order. Same failure posture: the order's state
 * is the truth and is never touched here; the stamp lands ONLY on a send
 * that really left, so `status IN (REQUESTED, CONFIRMED) AND
 * vendorBookedNotifiedAt IS NULL` on a BOOKED order is the exact list a
 * human still has to phone. Both are idempotent on the stamp, so a
 * re-book or a second cancel never double-sends.
 *
 * The sub-rental's own status is NOT flipped by the booking: REQUESTED →
 * CONFIRMED is the PARTNER's word (their "Confirm hold" button), and the
 * client booking doesn't put words in their mouth. Cancellation does flip
 * it — a client cancelling ends the sub-rental whatever the partner said.
 */

import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { withTeamCc, agentReplyTo } from '@/lib/email/teamVisibility'
import { buildVendorBookedNotice, buildVendorCancelledNotice } from '@/lib/sub-rentals/vendorNotice'
import { vendorPagePath } from '@/lib/sub-rentals/potentialSubRental'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'
import { stampVendorCost } from '@/lib/sub-rentals/partnerShare'
import { bindSubRentalToOrderLine } from '@/lib/sub-rentals/bindToOrderLine'

export interface LifecycleNoticeOutcome {
  subRentalId: string
  vendorName: string
  vehicleName: string
  notified: boolean
  warning: string | null
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

async function orderContext(orderId: string) {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, jobId: true, job: { select: { jobCode: true, name: true, reportToAddress: true, shootArea: true } }, agent: { select: { name: true, email: true } } },
  })
  if (!o) return null
  return { orderId: o.id, jobId: o.jobId ?? null, jobCode: o.job?.jobCode ?? null, agentName: o.agent?.name ?? null, agentEmail: o.agent?.email ?? null, deliverTo: { address: o.job?.reportToAddress ?? null, area: o.job?.shootArea ?? null }, jobName: o.job?.name ?? null }
}

function scope(orderId: string, jobId: string | null) {
  return { OR: [{ orderId }, ...(jobId ? [{ orderId: null, jobId }] : [])] }
}

/** Everything the partner notices need that isn't on the sub-rental row.
 *  orderId is nullable because a JOB-level release (the "release the whole
 *  job" button) has no single order to attribute the send to — an estimated
 *  sub-rental exists before any order does. */
export interface LifecycleContext {
  orderId: string | null
  jobId: string | null
  jobCode: string | null
  agentName: string | null
  agentEmail: string | null
  deliverTo: { address: string | null; area: string | null }
  jobName: string | null
}

/** Same context, resolved from the JOB rather than one of its orders. */
export async function jobLifecycleContext(jobId: string): Promise<LifecycleContext | null> {
  const j = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true, jobCode: true, name: true, reportToAddress: true, shootArea: true,
      agent: { select: { name: true, email: true } },
    },
  })
  if (!j) return null
  return {
    orderId: null, jobId: j.id, jobCode: j.jobCode,
    agentName: j.agent?.name ?? null, agentEmail: j.agent?.email ?? null,
    deliverTo: { address: j.reportToAddress ?? null, area: j.shootArea ?? null },
    jobName: j.name ?? null,
  }
}

/** The order was BOOKED: tell every partner with a live unit on it. */
export async function notifySubRentalsBooked(orderId: string): Promise<LifecycleNoticeOutcome[]> {
  const ctx = await orderContext(orderId)
  if (!ctx) return []
  const subs = await prisma.subRental.findMany({
    where: { ...scope(ctx.orderId, ctx.jobId), status: { in: ['REQUESTED', 'CONFIRMED'] }, vendorBookedNotifiedAt: null },
    select: {
      id: true, itemDescription: true, quantity: true, startDate: true, endDate: true, vendorToken: true,
      vendorConfirmedAt: true, driverName: true, receiveMethod: true,
      subcontractedVehicle: { select: { name: true } },
      vendor: { select: { name: true, email: true, poEmail: true, contactName: true } },
    },
  })
  const out: LifecycleNoticeOutcome[] = []
  for (const s of subs) {
    const vehicleName = s.subcontractedVehicle?.name ?? s.itemDescription
    const o: LifecycleNoticeOutcome = { subRentalId: s.id, vendorName: s.vendor.name, vehicleName, notified: false, warning: null }
    // Booking is the last moment to bind this row to the line it fulfils.
    // The LCDW paths read that link to tell a partner unit from ours; an
    // unlinked one gets a damage waiver offered on it (Wes 2026-09-07).
    const bind = await bindSubRentalToOrderLine(s.id).catch(() => ({ bound: false as const, reason: 'bind threw' }))
    const to = s.vendor.poEmail ?? s.vendor.email
    const start = iso(s.startDate), end = iso(s.endDate)
    if (!bind.bound) o.warning = `${vehicleName} is not linked to a line on this order (${bind.reason}) — check the damage-waiver offer before quoting it.`
    if (!to) o.warning = `${s.vendor.name} has no email on file — nobody told them ${vehicleName} is a go.`
    else if (!start || !end || !s.vendorToken) o.warning = `${vehicleName} has no dates or no partner page, so ${s.vendor.name} could not be told it's a go.`
    else {
      const cost = await stampVendorCost(s.id).catch(() => null)
      const notice = buildVendorBookedNotice({
        vendorName: s.vendor.name, vehicleName, startDate: start, endDate: end, quantity: s.quantity,
        reference: ctx.jobCode, vendorUrl: `${PUBLIC_SITE_ORIGIN}${vendorPagePath(s.vendorToken)}`,
        agentName: ctx.agentName ?? 'Team SirReel', holdConfirmed: !!s.vendorConfirmedAt, driverNamed: !!s.driverName,
        rate: cost,
        delivery: s.receiveMethod === 'DELIVERY',
        contactFirstName: (s.vendor.contactName ?? '').split(/\s+/)[0] || null,
        deliverTo: ctx.deliverTo,
        jobName: ctx.jobName,
      })
      const res = await sendAgreementEmail({
        to: [to], cc: await withTeamCc([], to), replyTo: agentReplyTo(ctx.agentEmail) ?? undefined,
        subject: notice.subject, html: notice.html, text: notice.text, label: 'sub-rental-booked', orderId: ctx.orderId,
      }).catch((err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : 'send threw' }))
      if (res.ok) {
        o.notified = true
        await prisma.subRental.update({ where: { id: s.id }, data: { vendorBookedNotifiedAt: new Date() } })
      } else o.warning = `${s.vendor.name} could not be told ${vehicleName} is a go: ${res.reason}`
    }
    await prisma.auditLog.create({
      data: { action: 'sub_rental.booked_notice', entityType: 'SubRental', entityId: s.id, newValues: { notified: o.notified, warning: o.warning, orderId: ctx.orderId } },
    }).catch(() => {})
    out.push(o)
  }
  return out
}

/** The order was CANCELLED: release every live unit and tell its partner. */
export async function notifySubRentalsCancelled(orderId: string): Promise<LifecycleNoticeOutcome[]> {
  const ctx = await orderContext(orderId)
  if (!ctx) return []
  return cancelSubRentalsWhere(
    { ...scope(ctx.orderId, ctx.jobId), status: { in: RELEASABLE_SUB_RENTAL_STATUSES } },
    ctx,
  )
}

/** The statuses a hold can still be RELEASED from. PICKED_UP / ON_RENT are
 *  deliberately absent: the partner's unit is physically out, so ending that
 *  is a return, not a release, and must not be done by a checkbox. */
export const RELEASABLE_SUB_RENTAL_STATUSES = ['ESTIMATED', 'REQUESTED', 'CONFIRMED'] as const

/**
 * Release a NAMED set of sub-rentals and tell each partner (Wes 2026-09-08:
 * "theoretically, they could release the restroom trailer and not the
 * motorhome"). Same release + notice + audit as the order-cancelled path —
 * the only difference is which rows are in scope, so a partial release and a
 * whole-job release cannot drift apart.
 *
 * Ids are intersected with `scopeWhere` by the caller's own query, so an id
 * from another job can never be released through here.
 */
export async function cancelSubRentalsById(
  subRentalIds: string[],
  ctx: LifecycleContext,
): Promise<LifecycleNoticeOutcome[]> {
  if (subRentalIds.length === 0) return []
  return cancelSubRentalsWhere(
    { id: { in: subRentalIds }, status: { in: RELEASABLE_SUB_RENTAL_STATUSES } },
    ctx,
  )
}

async function cancelSubRentalsWhere(
  where: Record<string, unknown>,
  ctx: LifecycleContext,
): Promise<LifecycleNoticeOutcome[]> {
  const subs = await prisma.subRental.findMany({
    where,
    select: {
      id: true, status: true, itemDescription: true, quantity: true, startDate: true, endDate: true, vendorToken: true,
      vendorHoldRequestedAt: true, vendorNotifiedAt: true, vendorCancelNotifiedAt: true,
      subcontractedVehicle: { select: { name: true } },
      vendor: { select: { name: true, email: true, poEmail: true } },
    },
  })
  const out: LifecycleNoticeOutcome[] = []
  for (const s of subs) {
    const vehicleName = s.subcontractedVehicle?.name ?? s.itemDescription
    const o: LifecycleNoticeOutcome = { subRentalId: s.id, vendorName: s.vendor.name, vehicleName, notified: false, warning: null }
    // The release is durable whatever the mail does.
    await prisma.subRental.update({ where: { id: s.id }, data: { status: 'CANCELLED' } })
    // A partner who was never told anything (an ESTIMATED row whose notice
    // never went) has nothing to un-hear; everyone else gets the release.
    const wasTold = !!(s.vendorHoldRequestedAt || s.vendorNotifiedAt)
    const to = s.vendor.poEmail ?? s.vendor.email
    const start = iso(s.startDate), end = iso(s.endDate)
    if (!wasTold || s.vendorCancelNotifiedAt) o.notified = false
    else if (!to) o.warning = `${s.vendor.name} has no email on file — nobody told them ${vehicleName} is released.`
    else if (!start || !end) o.warning = `${vehicleName} had no dates, so ${s.vendor.name} was not told it's released.`
    else {
      const notice = buildVendorCancelledNotice({
        vendorName: s.vendor.name, vehicleName, startDate: start, endDate: end, quantity: s.quantity,
        reference: ctx.jobCode, vendorUrl: s.vendorToken ? `${PUBLIC_SITE_ORIGIN}${vendorPagePath(s.vendorToken)}` : '',
        agentName: ctx.agentName ?? 'Team SirReel',
      })
      const res = await sendAgreementEmail({
        to: [to], cc: await withTeamCc([], to), replyTo: agentReplyTo(ctx.agentEmail) ?? undefined,
        subject: notice.subject, html: notice.html, text: notice.text, label: 'sub-rental-cancelled', orderId: ctx.orderId,
      }).catch((err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : 'send threw' }))
      if (res.ok) {
        o.notified = true
        await prisma.subRental.update({ where: { id: s.id }, data: { vendorCancelNotifiedAt: new Date() } })
      } else o.warning = `${s.vendor.name} could not be told ${vehicleName} is released: ${res.reason}`
    }
    await prisma.auditLog.create({
      // Named for what actually released it, so the trail distinguishes an
      // order cancellation from a human releasing this unit off the job.
      data: {
        action: ctx.orderId ? 'sub_rental.cancelled_by_order' : 'sub_rental.released_by_job',
        entityType: 'SubRental', entityId: s.id, oldValues: { status: s.status },
        newValues: { status: 'CANCELLED', notified: o.notified, warning: o.warning, orderId: ctx.orderId, jobId: ctx.jobId },
      },
    }).catch(() => {})
    out.push(o)
  }
  return out
}
