/**
 * Pure (no-side-effect) composer for the quote-send email.
 *
 * Used by:
 *   - the preview endpoint (no token mint, no Resend, no state writes)
 *   - the send route (after mint + before Resend dispatch)
 *
 * Single source of truth so the preview the agent reviews can't drift
 * from what actually leaves the system. The send route layers in: PDF
 * buffer fetch, magic-link mint, Resend dispatch, Order state write.
 * Everything else — recipient ranking, subject/body render, attachment
 * metadata — lives here.
 *
 * CTA URL handling (see brief):
 *   - Preview path passes `portalUrl: null` → the rendered HTML omits
 *     the "Open Your Customer Portal" button entirely. The preview UI
 *     surfaces an annotation explaining the link is minted on send.
 *   - Send path mints the magic-link, builds the tokenized URL, and
 *     passes it in; the rendered HTML carries the live link.
 */

import { get as getBlob } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { rankRecipients, type RankedRecipient } from '@/lib/email/recipients'
import { buildQuoteSendEmail } from '@/lib/email/templates/quoteSend'
import { SEND_FROM } from '@/lib/email/sendAgreementEmail'

export interface AttachmentMeta {
  filename: string
  mimeType: string
  /** Best-effort byte count for the preview UI. Missing → preview UI
   *  just shows the filename without a size. */
  sizeBytes?: number
}

export interface QuoteEmailCompositionOk {
  ok: true
  to: RankedRecipient
  /** Other ranked recipients on this order — surfaces in the modal's
   *  "Change recipient" affordance. Excludes `to`. */
  alternatives: RankedRecipient[]
  from: string
  subject: string
  html: string
  text: string
  attachments: AttachmentMeta[]
  order: {
    id: string
    orderNumber: string
    jobName: string | null
    portalSlug: string | null
  }
  /** True when the rendered HTML body's Portal CTA carries a token.
   *  False on preview, true on send. The preview UI uses this to
   *  decide whether to show the "secured at send time" annotation. */
  portalUrlIsTokenized: boolean
}

export type QuoteEmailComposition =
  | QuoteEmailCompositionOk
  | { ok: false; status: number; error: string }

export interface ComposeQuoteEmailArgs {
  orderId: string
  message?: string | null
  /** Pass null for preview (renders no portal button). Pass a fully
   *  tokenized URL for send. */
  portalUrl: string | null
  /** Skip attachment-metadata HEAD probe. Send path doesn't need the
   *  filename pre-known (it just builds Quote-{orderNumber}.pdf); the
   *  preview path uses the metadata. Default true. */
  includeAttachmentMeta?: boolean
}

export async function composeQuoteEmail(
  args: ComposeQuoteEmailArgs,
): Promise<QuoteEmailComposition> {
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      quotePdfKey: true,
      quotePdfUrl: true,
      portalSlug: true,
      agent: { select: { name: true, email: true } },
      job: {
        select: {
          name: true,
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          },
        },
      },
      jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })
  if (!order) return { ok: false, status: 404, error: 'order not found' }

  if (!order.quotePdfKey || !order.quotePdfUrl) {
    return {
      ok: false,
      status: 400,
      error: 'No quote PDF — regenerate from the order detail page first.',
    }
  }

  const ranked = rankRecipients(order.job, order.jobContact)
  const to = ranked[0]
  if (!to) {
    return {
      ok: false,
      status: 400,
      error: 'No recipient — add a contact to the job first.',
    }
  }

  const attachments: AttachmentMeta[] = []
  if (args.includeAttachmentMeta !== false) {
    // Best-effort filename + size. If the HEAD probe fails the preview
    // just shows the filename without a size — never block on it.
    const filename = `Quote-${order.orderNumber}.pdf`
    let sizeBytes: number | undefined
    try {
      const head = await getBlob(order.quotePdfKey, { access: 'private' })
      // Blob size lives on head.blob.size when the call succeeds (statusCode=200);
      // 304s return null. Either way we treat absent as "unknown size".
      sizeBytes = head?.statusCode === 200 ? head.blob.size : undefined
    } catch {
      sizeBytes = undefined
    }
    attachments.push({ filename, mimeType: 'application/pdf', sizeBytes })
  }

  const { subject, html, text } = buildQuoteSendEmail({
    firstName: to.name.split(' ')[0] || 'there',
    orderNumber: order.orderNumber,
    jobName: order.job?.name ?? 'your production',
    agentName: order.agent.name || 'SirReel',
    agentEmail: order.agent.email,
    portalUrl: args.portalUrl,
    customMessage: args.message ?? null,
  })

  return {
    ok: true,
    to,
    alternatives: ranked.slice(1),
    from: SEND_FROM,
    subject,
    html,
    text,
    attachments,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      jobName: order.job?.name ?? null,
      portalSlug: order.portalSlug,
    },
    portalUrlIsTokenized: args.portalUrl != null && args.portalUrl.includes('?token='),
  }
}
