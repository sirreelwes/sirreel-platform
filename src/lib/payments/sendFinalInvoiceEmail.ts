/**
 * Send the payment-options email for a recorded final invoice.
 *
 * One code path for both callers — the automatic send when an agent records
 * the invoice on the job page, and the manual (re)send from the collections
 * queue — so what the client receives cannot depend on which button fired it.
 *
 * Recipient: the job's ACCOUNTING contact when there is one — this is money
 * mail, and productions route it to accounting even when a PM runs everything
 * else — falling back to the primary-contact convention (PM → PC → marked
 * primary → first), skipping contacts without an email. No recipient is a
 * reported outcome, not an error: the invoice still lands in the collections
 * queue and the queue shows WHY nothing was emailed.
 *
 * Failure never blocks the upload. A recorded invoice with no email is a
 * follow-up; an upload that failed because Resend hiccuped is lost work.
 */

import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { withBillingCc } from '@/lib/email/billingVisibility'
import { buildFinalInvoiceEmail, type CardOnFile } from '@/lib/email/templates/finalInvoiceReady'
import { fetchBlobBuffer } from '@/lib/email/paymentInfoAttachments'
import { loadPaymentRecord } from '@/lib/payments/sendPaymentDetails'
import { isPaymentConfigured } from '@/lib/payments/paymentDetails'
import { createPaymentShare, paymentShareBaseUrl } from '@/lib/payments/paymentShare'

export type FinalInvoiceEmailResult =
  | { ok: true; to: string; pdfAttached: boolean }
  | { ok: false; reason: 'not_found' | 'not_ready' | 'no_recipient' | 'not_configured' }
  | { ok: false; reason: 'send_failed'; detail: string }

/** Money mail goes to accounting first; then the primary-contact convention. */
const ROLE_ORDER = ['ACCOUNTING', 'PM', 'PC'] as const

async function resolveBillingRecipient(
  jobId: string,
): Promise<{ email: string; firstName: string; personId: string } | null> {
  const contacts = await prisma.jobContact.findMany({
    where: { jobId },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      isPrimary: true,
      person: { select: { id: true, firstName: true, email: true } },
    },
  })
  const withEmail = contacts.filter((c) => c.person.email?.trim())
  if (withEmail.length === 0) return null

  for (const role of ROLE_ORDER) {
    const hit = withEmail.find((c) => c.role === role)
    if (hit) return pick(hit)
  }
  const primary = withEmail.find((c) => c.isPrimary)
  return pick(primary ?? withEmail[0])

  function pick(c: (typeof withEmail)[number]) {
    return {
      email: c.person.email.trim().toLowerCase(),
      firstName: c.person.firstName,
      personId: c.person.id,
    }
  }
}

/**
 * Newest signed card authorization across the job's bookings, display fields
 * only — the token itself never leaves the row. Mirrors the job-page
 * derivation (paperwork is booking-scoped).
 */
async function cardOnFileForJob(jobId: string): Promise<CardOnFile | null> {
  const bookings = await prisma.booking.findMany({
    where: { jobId },
    select: { id: true },
  })
  if (bookings.length === 0) return null
  const pw = await prisma.paperworkRequest.findFirst({
    where: {
      bookingId: { in: bookings.map((b) => b.id) },
      ccCardNumberEncrypted: { not: null },
    },
    orderBy: { sentAt: 'desc' },
    select: { ccCardLast4: true, ccCardType: true },
  })
  return pw ? { last4: pw.ccCardLast4, cardType: pw.ccCardType } : null
}

export async function sendFinalInvoicePaymentOptions(
  finalInvoiceId: string,
): Promise<FinalInvoiceEmailResult> {
  const fi = await prisma.jobFinalInvoice.findUnique({
    where: { id: finalInvoiceId },
    select: {
      id: true,
      status: true,
      amount: true,
      invoiceNumber: true,
      pdfKey: true,
      job: { select: { id: true, name: true } },
    },
  })
  if (!fi) return { ok: false, reason: 'not_found' }
  // COLLECTED and VOID rows are done — "here's how to pay" after the money
  // arrived reads as a dunning error and burns trust.
  if (fi.status !== 'READY') return { ok: false, reason: 'not_ready' }

  const details = await loadPaymentRecord()
  if (!details || !isPaymentConfigured(details)) return { ok: false, reason: 'not_configured' }

  const recipient = await resolveBillingRecipient(fi.job.id)
  if (!recipient) return { ok: false, reason: 'no_recipient' }

  const cardOnFile = await cardOnFileForJob(fi.job.id)

  // The pay-details link is the ONLY route to the bank details in this email
  // (link-only, Wes ruled 2026-08-18) — so unlike the operator send's
  // best-effort anchor, a mint failure here fails the send. An email whose
  // primary no-fee payment option is missing is not a degraded success; it is
  // a message we would have to re-send anyway.
  let payDetailsLink: string
  try {
    const share = await createPaymentShare({
      sentToEmail: recipient.email,
      createdVia: 'OPERATOR',
      personId: recipient.personId,
    })
    payDetailsLink = `${paymentShareBaseUrl()}/pay-details/${share.token}`
  } catch (err) {
    console.error('[final-invoice-email] could not mint the pay-details link:', err)
    return { ok: false, reason: 'send_failed', detail: 'could not mint the payment-details link' }
  }

  // The invoice PDF, from its private blob. Fetch failure drops the
  // attachment, not the email — the amount and options are the message.
  let attachment: { filename: string; content: Buffer } | null = null
  if (fi.pdfKey) {
    try {
      attachment = {
        filename: fi.invoiceNumber
          ? `SirReel-Invoice-${fi.invoiceNumber}.pdf`
          : 'SirReel-Final-Invoice.pdf',
        content: await fetchBlobBuffer(fi.pdfKey),
      }
    } catch (err) {
      console.error(
        '[final-invoice-email] invoice PDF fetch failed — sending without it:',
        err instanceof Error ? err.message : err,
      )
    }
  }

  const email = buildFinalInvoiceEmail({
    firstName: recipient.firstName,
    jobName: fi.job.name,
    invoiceNumber: fi.invoiceNumber,
    amount: Number(fi.amount),
    details,
    cardOnFile,
    payDetailsLink,
    pdfAttached: !!attachment,
  })

  // Billing sees the invoice leave, not just the replies to it
  // (Wes 2026-09-04). Channel-driven — /admin/notifications.
  const ccList = await withBillingCc([], recipient.email)

  const sent = await sendAgreementEmail({
    to: [recipient.email],
    cc: ccList.length > 0 ? ccList : undefined,
    replyTo: 'billing@sirreel.com',
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: attachment ? [attachment] : undefined,
    label: 'final-invoice-payment-options',
  })
  if (!sent.ok) return { ok: false, reason: 'send_failed', detail: sent.reason }

  await prisma.jobFinalInvoice.update({
    where: { id: fi.id },
    data: { emailedAt: new Date(), emailedTo: recipient.email },
  })

  return { ok: true, to: recipient.email, pdfAttached: !!attachment }
}
