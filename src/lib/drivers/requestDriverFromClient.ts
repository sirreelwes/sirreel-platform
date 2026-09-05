/**
 * Ask the production to name their driver — from the job's Drivers card.
 *
 * Wes 2026-09-05: "I don't have the driver's email so we need to prompt
 * Luis to input it. He did already send the license but that's a step I'd
 * prefer the driver make." So this emails the production contact a link
 * that lands on the drivers section of THEIR portal page, where the one
 * thing they can do is type an email; the driver's own invite (licence
 * upload, pickup info, codes on a blind pickup) follows from that.
 *
 * The contact is the signatory ladder the job page already uses
 * (PRODUCER → marked primary → PM → PC → first), overridable by
 * contactId. The link is a REFRESHED portal magic link for that person
 * on the job's live order — the same access they already hold, not a
 * second row per nudge.
 */

import { prisma } from '@/lib/prisma'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobUrl } from '@/lib/portal/portalUrl'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { withTeamCc } from '@/lib/email/teamVisibility'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { buildDriverRequestEmail } from '@/lib/email/templates/driverRequest'

export class DriverRequestError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export interface RequestDriverResult {
  sentTo: string
  contactName: string
  sentAt: Date
  emailOk: boolean
  emailError: string | null
  vehicles: string[]
}

const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export async function requestDriverFromClient(args: { jobId: string; contactId?: string | null }): Promise<RequestDriverResult> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: {
      id: true, name: true,
      agent: { select: { name: true, email: true, phone: true } },
      jobContacts: {
        orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }],
        select: { role: true, isPrimary: true, person: { select: { id: true, firstName: true, lastName: true, email: true } } },
      },
      orders: {
        where: { status: { not: 'CANCELLED' }, portalSlug: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, blindPickup: true },
      },
      bookings: {
        where: { status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
        select: {
          jobName: true,
          items: {
            select: {
              assignments: {
                where: { status: { in: ['ASSIGNED', 'CHECKED_OUT'] } },
                select: {
                  startDate: true, endDate: true,
                  asset: { select: { unitName: true, category: { select: { name: true } } } },
                  driverAssignments: { where: { status: { not: 'CANCELLED' } }, select: { id: true } },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!job) throw new DriverRequestError('Job not found', 404)

  const contacts = job.jobContacts
  const contact = args.contactId
    ? contacts.find((c) => c.person.id === args.contactId)
    : contacts.find((c) => c.role === 'PRODUCER') ??
      contacts.find((c) => c.isPrimary) ??
      contacts.find((c) => c.role === 'PM') ??
      contacts.find((c) => c.role === 'PC') ??
      contacts[0]
  if (!contact) throw new DriverRequestError('This job has no contact to ask — add one first.')
  const email = contact.person.email?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DriverRequestError(`${contact.person.firstName} has no usable email on file.`)
  }

  const order = job.orders[0]
  if (!order) throw new DriverRequestError('This job has no order with a client portal yet — send the quote first.')

  // Units still needing a driver. A unit that already has one named is
  // left out of the ask; if every unit is covered there is nothing to ask.
  const units = job.bookings.flatMap((b) => b.items.flatMap((it) => it.assignments))
  const needing = units.filter((a) => a.driverAssignments.length === 0)
  if (units.length === 0) throw new DriverRequestError('No unit is assigned yet — pick the truck first, then ask for the driver.')
  if (needing.length === 0) throw new DriverRequestError('Every unit on this job already has a driver named.')

  const vehicles = needing.map((a) => {
    const cat = a.asset.category?.name
    const span = fmtDay(a.startDate) === fmtDay(a.endDate) ? fmtDay(a.startDate) : `${fmtDay(a.startDate)} – ${fmtDay(a.endDate)}`
    return `${a.asset.unitName}${cat ? ` (${cat})` : ''} · ${span}`
  })
  const pickupDate = needing.map((a) => a.startDate).sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString().slice(0, 10) ?? null

  const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { portalSlug: true } })
  const link = await refreshOrIssueJobMagicLink({ orderId: order.id, contactId: contact.person.id })
  const portalLink = `${portalJobUrl(orderRow.portalSlug!, link.token)}#drivers`

  const productionName = job.bookings[0]?.jobName || job.name
  const tpl = buildDriverRequestEmail({
    firstName: contact.person.firstName,
    productionName,
    vehicles,
    pickupDate,
    unattendedPickup: job.orders.some((o) => o.blindPickup),
    portalLink,
    repName: job.agent?.name || 'the SirReel team',
    repPhone: job.agent?.phone || null,
    repEmail: job.agent?.email || null,
  })
  const cc = await withTeamCc([], email)
  const result = await sendAgreementEmail({
    label: 'driver/request',
    to: [email],
    cc: cc.length ? cc : undefined,
    replyTo: job.agent?.email ?? undefined,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    orderId: order.id,
  })
  const sentAt = new Date()
  if (result.ok) {
    if (result.id) {
      await recordEmailDelivery({ resendMessageId: result.id, toAddress: email, subject: tpl.subject, label: 'driver/request', orderId: order.id })
    }
    await prisma.job.update({ where: { id: job.id }, data: { driverRequestSentAt: sentAt, driverRequestSentTo: email } })
  }
  return {
    sentTo: email,
    contactName: `${contact.person.firstName} ${contact.person.lastName}`.trim(),
    sentAt,
    emailOk: result.ok,
    emailError: result.ok ? null : result.reason,
    vehicles,
  }
}
