/**
 * Tell the desk a client just paid in the portal.
 *
 * Ana, 2026-09-14: *"a notification sent to me if client pays through the
 * portal. That way I can keep track of payments easier."*
 *
 * Fire-and-forget by design, and called AFTER the payment is recorded: the
 * money is in and the invoice is reconciled whether or not this email sends.
 * Nothing here may throw into the payment route — a failed notification must
 * never turn a successful charge into a 500 the client sees.
 *
 * Recipients come from the `portal-payments` channel, so the audience is
 * editable at /admin/notifications instead of in a deploy.
 */

import { prisma } from '@/lib/prisma'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildPortalPaymentEmail } from '@/lib/email/templates/portalPaymentReceived'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'

export interface NotifyPortalPaymentInput {
  invoiceId: string
  portalAccessId: string
  amount: number
  surcharge?: number | null
  kind: 'CARD' | 'ACH'
  reference?: string | null
  at?: Date
}

export async function notifyPortalPayment(input: NotifyPortalPaymentInput): Promise<boolean> {
  try {
    const to = await channelRecipients('portal-payments')
    if (!to.length) return false

    const [invoice, access] = await Promise.all([
      prisma.invoice.findUnique({
        where: { id: input.invoiceId },
        select: {
          invoiceNumber: true,
          balanceDue: true,
          status: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              job: { select: { name: true } },
              booking: { select: { jobName: true } },
            },
          },
        },
      }),
      prisma.portalAccess.findUnique({
        where: { id: input.portalAccessId },
        select: {
          contact: { select: { firstName: true, lastName: true, email: true } },
          order: { select: { job: { select: { company: { select: { name: true } } } } } },
        },
      }),
    ])
    if (!invoice) return false

    const balanceDue = Number(invoice.balanceDue ?? 0)
    const contact = access?.contact
    const paidByName = contact
      ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || null
      : null

    const base = process.env.NEXTAUTH_URL || 'https://hq.sirreel.com'
    const mail = buildPortalPaymentEmail({
      paidByName,
      paidByEmail: contact?.email ?? null,
      companyName: access?.order?.job?.company?.name ?? null,
      // The client-facing headline, same resolution the portal uses — the
      // desk should read the name the client would recognise.
      jobName: resolveDisplayJobName({
        bookingJobName: invoice.order?.booking?.jobName ?? null,
        jobName: invoice.order?.job?.name ?? null,
      }),
      orderNumber: invoice.order?.orderNumber ?? null,
      invoiceNumber: invoice.invoiceNumber,
      amount: input.amount,
      surcharge: input.surcharge ?? null,
      kind: input.kind,
      reference: input.reference ?? null,
      balanceDue,
      // An ACH origination is pending money: the invoice balance has not
      // moved, so "paid in full" must never render off it.
      paidInFull: input.kind === 'CARD' && balanceDue <= 0,
      at: input.at ?? new Date(),
      invoiceLink: invoice.order?.id ? `${base}/orders/${invoice.order.id}#invoices` : `${base}/collections`,
    })

    const r = await sendAgreementEmail({
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      label: `portal-payment:${invoice.invoiceNumber}`,
      invoiceId: input.invoiceId,
    })
    return r.ok
  } catch (e) {
    console.error('[notifyPortalPayment] failed', e)
    return false
  }
}
