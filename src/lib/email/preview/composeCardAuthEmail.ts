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
import { cardAskState, type CardAskReason } from '@/lib/payments/cardAsk'
import { resolveWalletCardForJob } from '@/lib/payments/jobCardOnFile'
import { isExpiryPast } from '@/lib/payments/companyCards'
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
  /** Booking the PaperworkRequest hangs off. The send route creates one
   *  when the job has none (ensureJobPaperworkBooking) and passes it in;
   *  a preview only looks, so this is null until the send. */
  bookingId: string | null
  /** Already on file — the caller shows "this client has a card" rather
   *  than pretending the ask is still open. */
  cardAlreadyOnFile: boolean
  /**
   * Why the ask is open, read off the job's card (Wes 2026-09-18). DECLINED
   * and EXPIRED mean a card IS on file and this email is asking for a second
   * one; the preview strip says so, so a rep can tell at a glance that they
   * are not about to re-ask a client who already paid attention.
   */
  cardAskReason: CardAskReason
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
  /** The booking the send route already ensured. Omit for a preview: the
   *  composer then resolves read-only and tolerates none. */
  bookingId?: string | null
}

/**
 * The booking a card authorization hangs off: the job's most recent
 * booking that hasn't been cancelled or archived. Read-only — the send
 * path uses ensureJobPaperworkBooking, which creates one when this
 * returns null.
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
      companyId: true,
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

  // A job is enough to ask for a card (Wes 2026-09-05) — the send route
  // creates the booking when there is none, so a missing one is no
  // longer a reason to refuse. The preview simply has no card-on-file
  // check to run yet.
  const bookingId = args.bookingId ?? (await resolveCardAuthBookingId(args.jobId))

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
  //
  // It also decides the WORDS (Wes 2026-09-18). A card that declined is still
  // on file — the portal stores the unapproved authorization because the
  // client is mid-form — so this ask is a replacement, and "we need a credit
  // card on file" is the wrong sentence to send the person who gave us one.
  // Derived here, server-side, from the same fact the tile renders: a flag
  // from the browser could send a client a decline notice about a card that
  // is fine.
  const existingCard = bookingId
    ? await prisma.paperworkRequest.findFirst({
        where: { bookingId, ccCardLast4: { not: null } },
        select: { id: true, ccAuthRespStat: true, ccCardExpiry: true },
      })
    : null
  // Same precedence as /api/jobs/[id]: the booking's own authorization wins,
  // and the company wallet answers for a job whose card was keyed from paper.
  const walletCard = existingCard ? null : await resolveWalletCardForJob(job.companyId, job.id)
  const cardOnFile = existingCard
    ? {
        onFile: true,
        validated: existingCard.ccAuthRespStat === 'A',
        expired: isExpiryPast(existingCard.ccCardExpiry),
      }
    : walletCard
  const ask = cardAskState(cardOnFile)

  const { subject, html, text } = buildCardAuthRequestEmail({
    firstName: to.name.split(' ')[0] || null,
    jobName: job.name,
    portalLink: args.portalLink,
    agentFirstName: (job.agent?.name || '').split(' ')[0] || null,
    personalNote: args.message ?? null,
    customBody: args.customMessage?.trim() || null,
    cardAskReason: ask.reason,
  })

  const order = job.orders[0]

  return {
    ok: true,
    defaultBody: defaultEmailBody({
      kind: 'card-auth',
      projectName: job.name,
      agentFirstName: (job.agent?.name || '').split(' ')[0] || null,
      cardAskReason: ask.reason,
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
    cardAlreadyOnFile: !!cardOnFile,
    cardAskReason: ask.reason,
  }
}
