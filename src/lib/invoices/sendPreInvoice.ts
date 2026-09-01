/**
 * Send the PRE-INVOICE for review (Wes 2026-09-01: "we need to add an
 * extra step before final invoice — 'Send Pre Invoice' to client and
 * that populates an email where they can view the invoice and hit
 * approve").
 *
 * The pre-invoice is NOT a second document. It is the DRAFT invoice —
 * same row, same number, same totals — presented for review before it
 * is issued. That is deliberate: two documents with two numbers is how
 * a client ends up paying the wrong one.
 *
 * What this does:
 *   1. Requires an existing DRAFT RENTAL invoice (generate first).
 *   2. Mints the client's portal magic link, same as sendInvoice.
 *   3. Emails the primary contact a link to review and approve. The PDF
 *      is NOT attached — the approve button lives in the portal, and an
 *      attachment invites the client to file it as though it were the
 *      invoice.
 *   4. Stamps preSentAt, which is what makes the DRAFT visible in the
 *      portal at all, and clears any previous change-request so a
 *      re-send starts a clean round.
 *
 * Deliberately does NOT touch Invoice.status or Order.status: nothing
 * has been issued, so nothing has moved. Only sendInvoice does that.
 */

import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { rankRecipients } from '@/lib/email/recipients'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobUrl, portalSignInUrl } from '@/lib/portal/portalUrl'
import { renderEmailShell, renderEmailText, p, detailTable } from '@/lib/email/templates/shell'

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

export async function sendPreInvoice(args: {
  invoiceId: string
  senderEmail: string
}): Promise<
  | { ok: true; sentTo: string; invoiceNumber: string; total: number }
  | { ok: false; status: number; error: string }
> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: args.invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      total: true,
      dueDate: true,
      clientApprovedAt: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          portalSlug: true,
          company: { select: { name: true } },
          jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
          job: {
            select: {
              id: true,
              name: true,
              jobContacts: {
                select: {
                  role: true,
                  isPrimary: true,
                  person: { select: { id: true, firstName: true, lastName: true, email: true } },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!invoice) return { ok: false, status: 404, error: 'invoice not found' }
  if (invoice.status !== 'DRAFT') {
    return {
      ok: false,
      status: 409,
      error: `invoice is ${invoice.status.toLowerCase()} — a pre-invoice round only applies before it is issued`,
    }
  }

  const ranked = rankRecipients(invoice.order.job, invoice.order.jobContact)
  const primary = ranked[0]
  if (!primary?.email) {
    return { ok: false, status: 400, error: 'no contact on this order to send the pre-invoice to' }
  }

  let portalUrl: string | null = null
  if (invoice.order.portalSlug) {
    try {
      const link = await refreshOrIssueJobMagicLink({
        orderId: invoice.order.id,
        contactId: primary.id,
      })
      portalUrl = portalJobUrl(invoice.order.portalSlug, link.token)
    } catch (err) {
      console.warn('[sendPreInvoice] portal-link mint failed:', err)
    }
  }
  const link = portalUrl ?? portalSignInUrl()

  const firstName = primary.name.split(' ')[0] || primary.name
  const jobLabel = invoice.order.job?.name ?? invoice.order.orderNumber
  const total = Number(invoice.total)

  const html = renderEmailShell({
    heading: `Your pre-invoice for ${jobLabel}`,
    eyebrow: 'Please review',
    preheader: `${fmtUsd(total)} — review and approve before we issue the invoice`,
    bodyHtml:
      p(`Hi ${firstName},`) +
      p(
        `Here is the pre-invoice for <strong>${jobLabel}</strong>. This is a review copy — ` +
          `nothing is due yet. Have a look, and if it all matches your records, hit approve and ` +
          `we will issue the final invoice.`,
      ) +
      detailTable([
        { label: 'Job', value: jobLabel },
        { label: 'Amount', value: fmtUsd(total) },
        { label: 'Reference', value: invoice.invoiceNumber },
      ]) +
      p(`If something looks off, use the same page to tell us what — it is easier to fix now than after the invoice goes out.`),
    cta: { label: 'Review the pre-invoice', href: link },
    footNote: 'This is a pre-invoice for review. It is not a request for payment.',
  })
  const text = renderEmailText([
    `Hi ${firstName},`,
    '',
    `Here is the pre-invoice for ${jobLabel}. This is a review copy — nothing is due yet.`,
    '',
    `Job: ${jobLabel}`,
    `Amount: ${fmtUsd(total)}`,
    `Reference: ${invoice.invoiceNumber}`,
    '',
    `Review and approve: ${link}`,
    '',
    'If something looks off, tell us on that page — easier to fix now than after the invoice goes out.',
  ])

  const result = await sendAgreementEmail({
    to: [primary.email],
    // Billing signs it and billing answers it — same as the real invoice.
    replyTo: 'billing@sirreel.com',
    subject: `Pre-invoice for ${jobLabel} — please review`,
    html,
    text,
    label: `send-pre-invoice:${invoice.invoiceNumber}`,
  })
  if (!result.ok) {
    return { ok: false, status: 502, error: `the email did not send (${result.reason}) — nothing was changed` }
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      preSentAt: new Date(),
      // A re-send opens a fresh round: a stale "changes requested" flag
      // beside a newly sent pre-invoice reads as unresolved when it is
      // exactly what this send addressed.
      clientChangeRequestedAt: null,
      clientChangeNote: null,
    },
  })

  return { ok: true, sentTo: primary.email, invoiceNumber: invoice.invoiceNumber, total }
}
