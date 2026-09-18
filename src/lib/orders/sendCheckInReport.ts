/**
 * Send the check-in report (Wes, 2026-09-18: *"Albert sends a report ...
 * on missing items or 100% returned. We need to add that button."*).
 *
 * Deliberately a BUTTON and not a side effect of filing, which is the one
 * design decision in here worth defending. A check-in sheet is filed in
 * passes — somebody does the walkies and hands over ([[check-passes]]) —
 * and every pass replaces the report in place. An email that went out on
 * file would announce gear as missing while it was still on the truck, and
 * then correct itself twice. So the record is written when the counting
 * happens, and the report is sent when a person says the counting is done.
 *
 * It does NOT replace the automatic L&D heads-up (notifyLdReported.ts):
 * that one fires on the delta the moment a shortfall is recorded, so the
 * billing desk hears about a missing case even if nobody ever presses this.
 * This is the human's summary of the whole order, clean returns included.
 *
 * Never throws for email reasons — the outcome comes back so the screen can
 * say what happened, the same contract the quote re-send uses.
 */

import { prisma } from '@/lib/prisma'
import { channelRecipients, dedupeEmails } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildCheckInReportEmail, type CheckInReportLine } from '@/lib/email/templates/checkInReport'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'

const base = () => process.env.NEXTAUTH_URL || 'https://hq.sirreel.com'

export type SendCheckInReportResult =
  | { sent: true; to: string[]; sentAt: string; clean: boolean }
  | { sent: false; reason: string }

export async function sendCheckInReport(input: {
  orderId: string
  sentById: string
  sentByName: string | null
}): Promise<SendCheckInReportResult> {
  const report = await prisma.orderCheckReport.findUnique({
    where: { orderId_edge: { orderId: input.orderId, edge: 'IN' } },
    select: {
      id: true,
      submittedAt: true,
      preppedBy: true,
      notes: true,
      lines: {
        select: {
          orderLineItemId: true, description: true, expectedQty: true,
          actualQty: true, damagedQty: true, onSheet: true, note: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!report) return { sent: false, reason: 'no check-in sheet has been filed for this order yet' }

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      job: { select: { name: true, company: { select: { name: true } } } },
      booking: { select: { jobName: true } },
      agent: { select: { email: true } },
    },
  })
  if (!order) return { sent: false, reason: 'order not found' }

  // Replacement cost per line, so the desk reads the size of the loss
  // without going and looking it up. A line with no figure says so.
  const lineIds = report.lines.map((l) => l.orderLineItemId).filter((v): v is string => !!v)
  const costByLine = new Map<string, number | null>(
    lineIds.length
      ? (
          await prisma.orderLineItem.findMany({
            where: { id: { in: lineIds } },
            select: { id: true, inventoryItem: { select: { replacementCost: true } } },
          })
        ).map((l) => [l.id, l.inventoryItem?.replacementCost == null ? null : Number(l.inventoryItem.replacementCost)])
      : [],
  )

  // An off-sheet line was never counted — it is STILL OUT, not missing.
  // Keeping those two apart is the whole safety property of partial
  // sheets, and an email that called them missing would undo it.
  const counted = report.lines.filter((l) => l.onSheet)
  const lines: CheckInReportLine[] = counted.map((l) => ({
    description: l.description,
    expectedQty: l.expectedQty,
    actualQty: l.actualQty,
    damagedQty: l.damagedQty,
    note: l.note?.trim() || null,
    replacementCost: l.orderLineItemId ? costByLine.get(l.orderLineItemId) ?? null : null,
  }))
  const stillOut = report.lines
    .filter((l) => !l.onSheet)
    .map((l) => ({ description: l.description, expectedQty: l.expectedQty }))

  const to = dedupeEmails([
    ...(await channelRecipients('check-in-report')),
    // The agent hears about their own order's return without anyone
    // having to remember to add them.
    ...(order.agent?.email ? [order.agent.email] : []),
  ])
  if (!to.length) return { sent: false, reason: 'the check-in report channel has no recipients' }

  const mail = buildCheckInReportEmail({
    orderNumber: order.orderNumber,
    jobName: resolveDisplayJobName({
      bookingJobName: order.booking?.jobName ?? null,
      jobName: order.job?.name ?? null,
    }),
    companyName: order.job?.company?.name ?? null,
    countedBy: report.preppedBy,
    sentBy: input.sentByName,
    filedAt: report.submittedAt,
    lines,
    stillOut,
    notes: report.notes?.trim() || null,
    orderLink: `${base()}/orders/${order.id}`,
    sheetLink: `${base()}/reports/orders/${order.id}/filed?edge=IN`,
  })

  const r = await sendAgreementEmail({
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    label: `check-in-report:${order.orderNumber}`,
    orderId: order.id,
  })
  if (!r.ok) return { sent: false, reason: r.reason || 'the email could not be sent' }

  const sentAt = new Date()
  // Stamped only on a send that actually went, so the button never reads
  // "sent" over an email nobody received.
  await prisma.orderCheckReport.update({
    where: { id: report.id },
    data: { reportSentAt: sentAt, reportSentById: input.sentById, reportSentTo: to },
  })
  await prisma.auditLog.create({
    data: {
      userId: input.sentById,
      action: 'order.check_in_report_sent',
      entityType: 'Order',
      entityId: order.id,
      oldValues: {},
      newValues: { reportId: report.id, to, subject: mail.subject, sentBy: input.sentByName },
    },
  }).catch(() => {})

  const clean =
    stillOut.length === 0 && lines.every((l) => l.actualQty >= l.expectedQty && l.damagedQty === 0)
  return { sent: true, to, sentAt: sentAt.toISOString(), clean }
}
