/**
 * Pure (no-side-effect) composer for the card-authorization request.
 *
 * Same contract as composeQuoteEmail / composeFollowUpEmail: recipient
 * ranking + body render in one place, called by BOTH the preview and the
 * send route so the two can never disagree about who it goes to or what
 * it says. The composer never writes — in particular it never mints the
 * PaperworkRequest token, which is why preview renders the CTA as an
 * annotation instead of a live button.
 */

import { prisma } from '@/lib/prisma'
import { rankRecipients, type RankedRecipient } from '@/lib/email/recipients'
import { buildCardAuthRequestEmail } from '@/lib/email/templates/cardAuthRequest'
import { defaultEmailBody } from '@/lib/email/standardOpening'
import { SEND_FROM } from '@/lib/email/sendAgreementEmail'

export interface CardAuthEmailCompositionOk {
  ok: true
  /** The standard ask, seeded into "Write my own email" so the rep edits
   *  real copy. Matches what the template renders when nothing is written.
   *  Excludes the never-editable security paragraph — see cardAuthRequest. */
  defaultBody: string
  to: RankedRecipient
  alternatives: RankedRecipient[]
  from: string
  subject: string
  html: string
  text: string
  attachments: [] // never any
  /** The modal's header block. A job may have no order yet (a hold placed
   *  before the quote), so this falls back to the job's own code. */
  order: {
    id: string
    orderNumber: string
    jobName: string | null
    portalSlug: string | null
    validUntil: Date | null
  }
  /** The REAL Order id, or null when the job has none yet. Separate from
   *  `order` above, whose id falls back to the job so the modal header can
   *  render — anchoring an EmailDelivery to that would be a bogus FK. */
  orderId: string | null
  portalUrlIsTokenized: boolean
  /** Booking the PaperworkRequest hangs off. The send route re-resolves
   *  it the same way; carried here so the preview can prove one exists. */
  bookingId: string
  /** Already on file — the caller shows "this client has a card" rather
   *  than pretending the ask is still open. */
  cardAlreadyOnFile: boolean
}

export type CardAuthEmailComposition =
  | CardAuthEmailCompositionOk
  | { ok: false; status: number; error: string }

export interface ComposeCardAuthEmailArgs {
  jobId: string
  message?: string | null
  /** Pass null for preview (renders the CTA as an annotation). Pass the
   *  tokenized /portal/v2/<token> URL for the real send. */
  portalLink: string | null
  /** Person.id override from the modal's recipient picker. Must be one of
   *  the ranked candidates on this job — same rule as the other composers,
   *  so a hand-crafted body can't redirect client mail to any address. */
  overrideContactId?: string | null
  /** "Write my own email" — replaces the templated ask and its closer. The
   *  security paragraph, the secure button and the sign-off stay. */
  customMessage?: string | null
}

/**
 * The booking a card authorization hangs off: the job's most recent
 * booking that hasn't been cancelled or archived. PaperworkRequest is
 * booking-scoped, so without one there is nothing to authorize against.
 *
 * Exported because the send route must resolve the SAME booking the
 * preview showed — see the header note about the two surfaces agreeing.
 */
export async function resolveCardAuthBookingId(jobId: string): Promise<string | null> {
  const booking = await prisma.booking.findFirst({
    where: { jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  return booking?.id ?? null
}

export async function composeCardAuthEmail(
  args: ComposeCardAuthEmailArgs,
): Promise<CardAuthEmailComposition> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: {
      id: true,
      jobCode: true,
      name: true,
      agent: { select: { name: true } },
      jobContacts: {
        select: {
          role: true,
          isPrimary: true,
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
      orders: {
        // OrderStatus has no LOST/VOID — a lost quote is tracked on
        // quoteStatus, and CANCELLED is the only terminal status here.
        where: { status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, orderNumber: true, portalSlug: true, expiresAt: true },
      },
    },
  })
  if (!job) return { ok: false, status: 404, error: 'job not found' }

  const bookingId = await resolveCardAuthBookingId(args.jobId)
  if (!bookingId) {
    return {
      ok: false,
      status: 409,
      error: 'No reservation on this job yet — add one before requesting a card.',
    }
  }

  const candidates = rankRecipients({ jobContacts: job.jobContacts }, null)
  if (candidates.length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'No contact with an email address on this job — add one first.',
    }
  }

  let to = candidates[0]
  if (args.overrideContactId) {
    const picked = candidates.find((c) => c.id === args.overrideContactId)
    if (!picked) {
      return { ok: false, status: 400, error: 'overrideContactId is not a contact on this job' }
    }
    to = picked
  }

  // Already-authorized check. The tile hides the button once a card is on
  // file, but the modal can be open across a client's portal submission.
  const existingCard = await prisma.paperworkRequest.findFirst({
    where: { bookingId, ccCardLast4: { not: null } },
    select: { id: true },
  })

  const { subject, html, text } = buildCardAuthRequestEmail({
    firstName: to.name.split(' ')[0] || null,
    jobName: job.name,
    portalLink: args.portalLink,
    agentFirstName: (job.agent?.name || '').split(' ')[0] || null,
    personalNote: args.message ?? null,
    customBody: args.customMessage?.trim() || null,
  })

  const order = job.orders[0]

  return {
    ok: true,
    defaultBody: defaultEmailBody({
      kind: 'card-auth',
      projectName: job.name,
      agentFirstName: (job.agent?.name || '').split(' ')[0] || null,
    }),
    to,
    alternatives: candidates,
    from: SEND_FROM,
    subject,
    html,
    text,
    attachments: [],
    order: {
      id: order?.id ?? job.id,
      orderNumber: order?.orderNumber ?? job.jobCode,
      jobName: job.name,
      portalSlug: order?.portalSlug ?? null,
      validUntil: order?.expiresAt ?? null,
    },
    orderId: order?.id ?? null,
    portalUrlIsTokenized: args.portalLink !== null,
    bookingId,
    cardAlreadyOnFile: !!existingCard,
  }
}
