/**
 * Per-send delivery-audit writer.
 *
 * sendAgreementEmail() now calls this for EVERY send, so no touchpoint
 * is invisible. Callers that know what the mail is anchored to (an
 * order, invoice or follow-up) still call it explicitly afterwards to
 * attach those ids — hence the UPSERT: the second call enriches the row
 * the send already created rather than colliding on the unique
 * resendMessageId.
 *
 * Status starts at SENT and is later advanced by the Resend webhook.
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
    const row = await prisma.emailDelivery.upsert({
      where: { resendMessageId: input.resendMessageId },
      create: {
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
      // Only ever ADD linkage — never null out what a prior call set, and
      // never touch status, which belongs to the webhook.
      update: {
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
        ...(input.quoteFollowUpId ? { quoteFollowUpId: input.quoteFollowUpId } : {}),
        ...(input.label ? { label: input.label } : {}),
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
