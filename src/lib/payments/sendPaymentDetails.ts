/**
 * Shared payment-details send — the exact branded email (structured
 * details + fraud line + private-Blob PDF attachments) that a known
 * client gets on /payment-info, factored out so the operator "Send
 * payment details" action can reuse it verbatim.
 *
 * SECURITY unchanged: details are emailed only, never rendered; the
 * caller (the operator, per Wes's fast-send ruling) is the identity
 * gate. This helper does NOT decide who qualifies — it just sends to
 * the address it's given. The /payment-info public gate is untouched.
 */

import { prisma } from '@/lib/prisma'
import { buildPaymentInfoEmail } from '@/lib/email/templates/paymentInfo'
import { fetchPaymentAttachments } from '@/lib/email/paymentInfoAttachments'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { isPaymentConfigured, type PaymentDetailsRecord } from '@/lib/payments/paymentDetails'

export type SendPaymentDetailsResult =
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'send_failed'; detail: string }
  | { ok: true; attachmentsSent: number; dropped: string[] }

export async function loadPaymentRecord(): Promise<PaymentDetailsRecord | null> {
  const s = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: {
      paymentPayeeName: true,
      paymentBankName: true,
      paymentAccountType: true,
      paymentAccountNumber: true,
      paymentRoutingAch: true,
      paymentRoutingWire: true,
      paymentRemittanceEmail: true,
      paymentBankAddress: true,
      paymentInstructions: true,
    },
  })
  const record: PaymentDetailsRecord = {
    payeeName: s?.paymentPayeeName ?? null,
    bankName: s?.paymentBankName ?? null,
    accountType: s?.paymentAccountType ?? null,
    accountNumber: s?.paymentAccountNumber ?? null,
    routingAch: s?.paymentRoutingAch ?? null,
    routingWire: s?.paymentRoutingWire ?? null,
    remittanceEmail: s?.paymentRemittanceEmail ?? null,
    bankAddress: s?.paymentBankAddress ?? null,
    instructions: s?.paymentInstructions ?? null,
  }
  return isPaymentConfigured(record) ? record : null
}

export async function sendPaymentDetailsEmail(opts: {
  to: string
  firstName: string | null
}): Promise<SendPaymentDetailsResult> {
  const record = await loadPaymentRecord()
  if (!record) return { ok: false, reason: 'not_configured' }

  const email = buildPaymentInfoEmail({ firstName: opts.firstName, details: record })

  // Attachment fetch failure NEVER blocks the email — inline details
  // still send; dropped slots are reported to the caller.
  const s = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: {
      paymentAchFormKey: true,
      paymentAchFormFilename: true,
      paymentBankInfoKey: true,
      paymentBankInfoFilename: true,
    },
  })
  const { attachments, dropped } = await fetchPaymentAttachments({
    achFormKey: s?.paymentAchFormKey ?? null,
    achFormFilename: s?.paymentAchFormFilename ?? null,
    bankInfoKey: s?.paymentBankInfoKey ?? null,
    bankInfoFilename: s?.paymentBankInfoFilename ?? null,
  })

  const sent = await sendAgreementEmail({
    to: [opts.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: attachments.length > 0 ? attachments : undefined,
    label: 'payment-info-operator-send',
  })
  if (!sent.ok) return { ok: false, reason: 'send_failed', detail: sent.reason }
  return { ok: true, attachmentsSent: attachments.length, dropped }
}
