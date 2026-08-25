import { prisma } from '@/lib/prisma'
import { signDetailsToken, detailsLinkUrl } from '@/lib/intake/detailsToken'

/**
 * Mints the one-tap "tell us your company and project" link the Quick
 * Reply email carries next to its ask. Returns null when there is nothing
 * to bind the link to — the email then falls back to its existing "just
 * reply with those" wording, which still works.
 *
 * Binding, in order of preference:
 *   bookingId — holds exist (company known, job unnamed). Rarer.
 *   inquiryId — the usual case. The ask fires when we have no company,
 *               and a soft hold requires one, so no Booking exists yet.
 *
 * Resolving the inquiry from the inbound message reuses the Inquiry ↔
 * thread rule from markInquiryResponded.ts: an Inquiry has no thread FK,
 * so it matches on its own rfc822MessageId or on
 * sourceMetadata.emailMessageId. Unlike that module we do NOT filter to
 * status=NEW / respondedAt null — the link is minted at send time, which
 * is exactly when the inquiry is being marked responded, and a race there
 * would silently drop the link.
 */
export async function resolveInquiryIdForInbound(
  inboundEmailMessageId: string | null | undefined,
): Promise<string | null> {
  if (!inboundEmailMessageId) return null
  try {
    const inbound = await prisma.emailMessage.findUnique({
      where: { id: inboundEmailMessageId },
      select: { id: true, rfc822MessageId: true },
    })
    if (!inbound) return null

    if (inbound.rfc822MessageId) {
      const byRfc = await prisma.inquiry.findFirst({
        where: { rfc822MessageId: inbound.rfc822MessageId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (byRfc) return byRfc.id
    }

    // sourceMetadata is JSON — matched in JS, same as the suggested-inquiries
    // route and markInquiryResponded. Bounded by the recency window.
    const recent = await prisma.inquiry.findMany({
      where: { convertedJobId: null, convertedOrderId: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, sourceMetadata: true },
    })
    const hit = recent.find((i) => {
      const meta = i.sourceMetadata as Record<string, unknown> | null
      return typeof meta?.emailMessageId === 'string' && meta.emailMessageId === inbound.id
    })
    return hit?.id ?? null
  } catch (err) {
    // Best-effort: losing the link costs a nicety, not the email.
    console.warn('[detailsLink] inquiry resolve failed (non-blocking):', err)
    return null
  }
}

export interface DetailsLinkArgs {
  askForCompany: boolean
  askForProject: boolean
  sentTo: string
  inboundEmailMessageId?: string | null
  bookingId?: string | null
}

/** The absolute /details/<token> URL, or null when nothing binds. */
export async function buildDetailsLink(args: DetailsLinkArgs): Promise<string | null> {
  if (!args.askForCompany && !args.askForProject) return null

  const bookingId = args.bookingId || null
  const inquiryId = bookingId ? null : await resolveInquiryIdForInbound(args.inboundEmailMessageId)
  if (!bookingId && !inquiryId) return null

  try {
    const token = signDetailsToken({
      ...(bookingId ? { bookingId } : { inquiryId: inquiryId! }),
      sentTo: args.sentTo,
      ask: { company: args.askForCompany, project: args.askForProject },
    })
    return detailsLinkUrl(token)
  } catch (err) {
    // signDetailsToken throws only when NEXTAUTH_SECRET is missing.
    console.warn('[detailsLink] token sign failed (non-blocking):', err)
    return null
  }
}
