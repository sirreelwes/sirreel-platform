/**
 * Per-send delivery-audit writer.
 *
 * Called by every order-anchored email send right after
 * sendAgreementEmail() succeeds. Writes one EmailDelivery row keyed
 * on the Resend message id; status starts at SENT and is later
 * advanced by the Resend webhook handler.
 *
 * Best-effort: failures here are logged but do NOT bubble to the
 * caller — the email already went out, refusing to record audit
 * isn't a reason to undo the send or 5xx the API call. (If the row
 * is missing, the webhook will simply not-find it and no-op; the
 * client still got the email.)
 */
import { prisma } from '@/lib/prisma'

export interface RecordEmailDeliveryInput {
  resendMessageId: string
  toAddress: string
  subject: string
  ccAddresses?: string[]
  label?: string | null
  orderId?: string | null
  invoiceId?: string | null
  quoteFollowUpId?: string | null
}

export async function recordEmailDelivery(
  input: RecordEmailDeliveryInput,
): Promise<{ ok: boolean; id?: string; reason?: string }> {
  try {
    const row = await prisma.emailDelivery.create({
      data: {
        resendMessageId: input.resendMessageId,
        toAddress: input.toAddress,
        ccAddresses: input.ccAddresses ?? [],
        subject: input.subject,
        label: input.label ?? null,
        orderId: input.orderId ?? null,
        invoiceId: input.invoiceId ?? null,
        quoteFollowUpId: input.quoteFollowUpId ?? null,
        // status defaults to SENT in the schema.
      },
      select: { id: true },
    })
    return { ok: true, id: row.id }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(
      `[recordEmailDelivery] failed for resendMessageId=${input.resendMessageId}: ${reason}`,
    )
    return { ok: false, reason }
  }
}
