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
import { channelRecipients } from '@/lib/email/notificationChannels'
import { rankRecipients, type RankedRecipient } from '@/lib/email/recipients'
import { buildWelcomeEmail } from '@/lib/email/templates/welcomeTemplate'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'
import { defaultEmailBody } from '@/lib/email/standardOpening'
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
  /** The standard quote wording, handed to the review modal so
   *  "Write my own email" opens on real copy instead of an empty box.
   *  Identical to what the template renders when nothing is written. */
  defaultBody: string
  to: RankedRecipient
  /** Other ranked recipients on this order — surfaces in the modal's
   *  "Change recipient" affordance. Excludes `to`. */
  alternatives: RankedRecipient[]
  /** Everyone who gets copied WITHOUT the rep typing them — the job's
   *  other contacts plus the shared sales desk. The review modal only
   *  ever showed To and the rep's own CC box, so an agent reviewing a
   *  quote could not see that the team was copied at all (Wes,
   *  2026-08-29: "a copy of the sent quote should go to sales team").
   *  Derived here rather than in the modal so preview and send cannot
   *  disagree about who receives the mail. */
  autoCc: { email: string; name: string | null; reason: 'job-contact' | 'sales-team' }[]
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
  /** "Write my own email": REPLACES the templated opener and closer.
   *  The greeting, the quote snapshot + portal CTA and the sign-off stay.
   *  Empty/null → the standard wording (see `defaultBody`). */
  customMessage?: string | null
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
      // Dates the quote actually covers — see deriveOrderWindow. The header
      // dates are optional and often blank; the lines and the hold are not.
      lineItems: { select: { pickupDate: true, returnDate: true } },
      booking: { select: { startDate: true, endDate: true, status: true } },
      agent: { select: { name: true, email: true, phone: true } },
      job: {
        select: {
          name: true,
          bookings: { select: { startDate: true, endDate: true, status: true } },
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

  // The send route attaches the stored quote PDF (see send-quote), so the
  // review modal has to say so — a rep approving an email should know
  // what leaves with it. Filename mirrors the one the send route builds.
  // No size: that would cost a blob HEAD on every keystroke-triggered
  // preview, and the field is optional precisely for this case.
  const attachments: AttachmentMeta[] = [
    { filename: `Quote-${order.orderNumber}.pdf`, mimeType: 'application/pdf' },
  ]

  // "Dates TBD" on a quote for gear we are already holding is the thing
  // Wes called out (2026-09-01). Fall through header → lines → hold.
  const quoteWindow = deriveOrderWindow(order)

  const { subject, html, text } = buildWelcomeEmail({
    mode: 'welcome-with-quote',
    customBody: args.customMessage?.trim() || null,
    clientFirstName: to.name.split(' ')[0] || null,
    clientFullName: to.name || null,
    agentName: order.agent.name || 'SirReel',
    agentEmail: order.agent.email,
    agentPhone: order.agent.phone,
    personalNote: args.message?.trim() || null,
    quote: {
      orderNumber: order.orderNumber,
      jobName: order.job?.name ?? 'your production',
      startDate: quoteWindow.start ? quoteWindow.start.toISOString() : null,
      endDate: quoteWindow.end ? quoteWindow.end.toISOString() : null,
      subtotal: order.subtotal != null ? Number(order.subtotal) : null,
      total: Number(order.total),
      portalUrl: args.portalUrl,
    },
  })

  // Same two inputs the send route composes its `cc` from: the ranked
  // non-primary contacts, then the sales-team channel (admin-managed at
  // /admin/notifications; may be one group address or several people).
  const team = await channelRecipients('sales-team-cc')
  const autoCc: { email: string; name: string | null; reason: 'job-contact' | 'sales-team' }[] =
    alternatives.map((a) => ({ email: a.email, name: a.name ?? null, reason: 'job-contact' as const }))
  for (const teamEmail of team) {
    if (autoCc.some((c) => c.email.toLowerCase() === teamEmail.toLowerCase())) continue
    if (to.email.toLowerCase() === teamEmail.toLowerCase()) continue
    autoCc.push({ email: teamEmail, name: 'Sales team', reason: 'sales-team' })
  }

  return {
    ok: true,
    defaultBody: defaultEmailBody({ kind: 'quote' }),
    to,
    alternatives,
    autoCc,
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
