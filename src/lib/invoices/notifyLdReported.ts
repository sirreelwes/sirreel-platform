/**
 * Tell the billing desk the floor just recorded L&D on an order.
 *
 * Ana, 2026-09-15: *"When sales/warehouse reports L&D on an order, it'd be
 * great if I can get that sent to me in an email so I know what to look out
 * for."* Recipients are the `ld-reported` channel (default billing@),
 * editable at /admin/notifications.
 *
 * Two doors, both called AFTER the record is written:
 *   - notifyMissingGear  — the check-in sheet counted gear short (or a
 *                          re-count found it)
 *   - notifyVehicleDamage — new damage on a vehicle return
 *
 * Same contract as notifyPortalPayment: awaited by the route (a serverless
 * function can freeze the instant it responds, so a floated promise never
 * sends), and it never throws — the sheet is the floor's work and a failed
 * email must not turn a filed check-in into an error on their screen.
 */

import { prisma } from '@/lib/prisma'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildLdReportedEmail, type LdDamageRow } from '@/lib/email/templates/ldReported'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import type { MissingGearDelta } from '@/lib/invoices/ldMissingGear'

const base = () => process.env.NEXTAUTH_URL || 'https://hq.sirreel.com'

export async function notifyMissingGear(input: {
  orderId: string
  delta: MissingGearDelta
  reportedBy: string | null
}): Promise<boolean> {
  try {
    const { newlyMissing, turnedUp } = input.delta
    if (!newlyMissing.length && !turnedUp.length) return false
    const to = await channelRecipients('ld-reported')
    if (!to.length) return false

    const [order, lines] = await Promise.all([
      prisma.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          orderNumber: true,
          job: { select: { name: true, company: { select: { name: true } } } },
          booking: { select: { jobName: true } },
        },
      }),
      newlyMissing.length
        ? prisma.orderLineItem.findMany({
            where: { id: { in: newlyMissing.map((m) => m.orderLineItemId) } },
            select: { id: true, inventoryItem: { select: { replacementCost: true } } },
          })
        : Promise.resolve([]),
    ])
    if (!order) return false
    const costByLine = new Map(
      lines.map((l) => [l.id, l.inventoryItem?.replacementCost == null ? null : Number(l.inventoryItem.replacementCost)]),
    )

    const mail = buildLdReportedEmail({
      source: 'CHECK_IN',
      orderNumbers: [order.orderNumber],
      jobName: resolveDisplayJobName({
        bookingJobName: order.booking?.jobName ?? null,
        jobName: order.job?.name ?? null,
      }),
      companyName: order.job?.company?.name ?? null,
      reportedBy: input.reportedBy,
      at: new Date(),
      missing: newlyMissing.map((m) => ({
        description: m.description,
        missing: m.missing,
        expectedQty: m.expectedQty,
        actualQty: m.actualQty,
        note: m.note,
        replacementCost: costByLine.get(m.orderLineItemId) ?? null,
      })),
      turnedUp,
      damage: [],
      orderLink: `${base()}/orders/${order.id}`,
      billingLink: `${base()}/collections`,
    })

    const r = await sendAgreementEmail({
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      label: `ld-reported:${order.orderNumber}`,
      orderId: order.id,
    })
    return r.ok
  } catch (e) {
    console.error('[notifyMissingGear] failed', e)
    return false
  }
}

export async function notifyVehicleDamage(input: {
  bookingAssignmentId: string
  reportedBy: string | null
  findings: Array<Omit<LdDamageRow, 'unitName'>>
}): Promise<boolean> {
  try {
    if (!input.findings.length) return false
    const to = await channelRecipients('ld-reported')
    if (!to.length) return false

    const assignment = await prisma.bookingAssignment.findUnique({
      where: { id: input.bookingAssignmentId },
      select: {
        asset: { select: { unitName: true } },
        bookingItem: {
          select: {
            booking: {
              select: {
                jobName: true,
                job: { select: { id: true, name: true, company: { select: { name: true } } } },
                orders: {
                  where: { NOT: { status: 'CANCELLED' } },
                  select: { id: true, orderNumber: true },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    })
    if (!assignment) return false
    const booking = assignment.bookingItem.booking
    const unitName = assignment.asset?.unitName ?? null
    const firstOrder = booking.orders[0]

    const mail = buildLdReportedEmail({
      source: 'VEHICLE_RETURN',
      orderNumbers: booking.orders.map((o) => o.orderNumber),
      jobName: resolveDisplayJobName({ bookingJobName: booking.jobName, jobName: booking.job?.name ?? null }),
      companyName: booking.job?.company?.name ?? null,
      reportedBy: input.reportedBy,
      at: new Date(),
      missing: [],
      turnedUp: [],
      damage: input.findings.map((f) => ({ ...f, unitName })),
      // A reservation with no order yet still has a job to land on.
      orderLink: firstOrder
        ? `${base()}/orders/${firstOrder.id}`
        : booking.job
          ? `${base()}/jobs/${booking.job.id}`
          : `${base()}/collections`,
      billingLink: `${base()}/collections`,
    })

    const r = await sendAgreementEmail({
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      label: `ld-reported:${firstOrder?.orderNumber ?? unitName ?? input.bookingAssignmentId}`,
      ...(firstOrder ? { orderId: firstOrder.id } : {}),
    })
    return r.ok
  } catch (e) {
    console.error('[notifyVehicleDamage] failed', e)
    return false
  }
}
