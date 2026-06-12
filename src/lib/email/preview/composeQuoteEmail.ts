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

import { prisma } from '@/lib/prisma'
import { rankRecipients, type RankedRecipient } from '@/lib/email/recipients'
import { buildTsxWelcomeEmail } from '@/lib/email/templates/tsxWelcomeTemplate'
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
  /** @deprecated kept for back-compat with the send route's old
   *  call site; the email no longer carries an attachment, so this
   *  flag is a no-op. Removed in a future cleanup. */
  includeAttachmentMeta?: boolean
  /** Person.id to use as the primary recipient instead of the
   *  canonical rank-0 pick. Backs the modal's "Change recipient"
   *  affordance. Validated against the ranked candidates on this
   *  order — rejected if not present (no arbitrary email injection
   *  through the send endpoint). */
  overrideContactId?: string | null
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
      startDate: true,
      endDate: true,
      subtotal: true,
      total: true,
      quotePdfKey: true,
      quotePdfUrl: true,
      portalSlug: true,
      agent: { select: { name: true, email: true, phone: true } },
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
  if (ranked.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'No recipient — add a contact to the job first.',
    }
  }

  // Apply optional override. Must be one of the ranked candidates;
  // anything else is rejected so this param can't be used to redirect
  // a send to an arbitrary email address.
  let to = ranked[0]
  let alternatives = ranked.slice(1)
  if (args.overrideContactId) {
    const idx = ranked.findIndex((r) => r.id === args.overrideContactId)
    if (idx < 0) {
      return {
        ok: false,
        status: 400,
        error: 'override contact is not on this order',
      }
    }
    to = ranked[idx]
    alternatives = ranked.filter((_, i) => i !== idx)
  }

  // Quote PDF is NO LONGER an email attachment. Per the unified
  // new-quote → send-as-finishing-move flow, the portal page exposes
  // a "Download quote PDF" affordance once the client clicks in.
  // Smaller email → better deliverability + a less intimidating first
  // touch. The attachments array stays in the response shape for
  // API back-compat; it's just empty.
  const attachments: AttachmentMeta[] = []

  const { subject, html, text } = buildTsxWelcomeEmail({
    mode: 'welcome-with-quote',
    clientFirstName: to.name.split(' ')[0] || null,
    clientFullName: to.name || null,
    agentName: order.agent.name || 'SirReel',
    agentEmail: order.agent.email,
    agentPhone: order.agent.phone,
    personalNote: args.message?.trim() || null,
    quote: {
      orderNumber: order.orderNumber,
      jobName: order.job?.name ?? 'your production',
      startDate: order.startDate ? order.startDate.toISOString() : null,
      endDate: order.endDate ? order.endDate.toISOString() : null,
      subtotal: order.subtotal != null ? Number(order.subtotal) : null,
      total: Number(order.total),
      portalUrl: args.portalUrl,
    },
  })

  return {
    ok: true,
    to,
    alternatives,
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
