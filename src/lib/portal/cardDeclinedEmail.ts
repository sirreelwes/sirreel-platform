/**
 * "Your card didn't go through" — to the CLIENT, when their bank refuses it.
 *
 * Wes, 2026-09-18: "WE NEED AN email to go out to the client when their card
 * declines." Until now nothing did. The decline sent one alert to the DESK
 * (`recordCardTrouble` → rentals@ + Wes, with the client only as Reply-To),
 * and from 2026-09-18 the portal also tells the client ON SCREEN — but that
 * reaches only the person still looking at the page. A client who submits,
 * reads "Card not approved" and closes the tab was never contacted again by
 * anything. This is the part that follows them.
 *
 * ── Scope: the PORTAL decline only ─────────────────────────────────────
 *
 * Wired to the one path where the CLIENT submitted the card and is the
 * person who has to fix it. The staff-keyed path (/crm/[id]#cards) is
 * deliberately NOT wired: there a staffer typed a card off paper the client
 * signed elsewhere, nothing is stored, the rep is standing right there with
 * the "Ask for another card" button (2026-09-18), and an automatic
 * "your card was declined" to a client who does not know we keyed anything
 * is a confusing email nobody chose to send. The rep sends the ask.
 *
 * ── What it must never do ──────────────────────────────────────────────
 *
 *   - Fire on a gateway that THREW. Only an explicit refusal reaches here;
 *     an unreachable gateway says nothing about the card, and telling a
 *     client their good card failed is worse than the silence it replaces.
 *     The caller passes the decision, it is not re-derived here.
 *   - Guess WHY. We do not know, their bank will not tell us, and
 *     "insufficient funds" guessed wrong at a production's accounting desk
 *     is its own phone call. Same rule as cardAskClientSentence().
 *   - Send twice for one sitting. A client trying three cards in five
 *     minutes gets ONE email — see the quiet window below.
 *   - Fail the client's submission. Fire-and-forget by contract, exactly
 *     like recordCardTrouble: their signature and paperwork are already
 *     written, and a Resend outage must never become their problem.
 */
import { prisma } from '@/lib/prisma'
import { sendOnJobThread } from '@/lib/email/jobThread'
import { portalV2Url } from '@/lib/portal/portalUrl'
import { buildCardDeclinedEmail } from '@/lib/email/templates/cardDeclined'

/** One email per client per hour, however many cards they try. Matches the
 *  desk alert's own window (cardTrouble.ts) so the two cannot disagree about
 *  what counts as one episode. */
const QUIET_MIN = 60

const AUDIT_ACTION = 'portal.card_declined_client_emailed'

/** Fire and forget. Callers MUST NOT await — see the header. */
export function emailClientAboutDecline(input: { token: string }): void {
  void run(input).catch((err) =>
    console.error('[card-declined-email] threw (the client is unaffected):', err),
  )
}

async function run({ token }: { token: string }): Promise<void> {
  const request = await prisma.paperworkRequest.findUnique({
    where: { token },
    select: {
      id: true,
      sentTo: true,
      ccCardLast4: true,
      booking: {
        select: {
          jobName: true,
          jobId: true,
          person: { select: { firstName: true, email: true } },
          job: { select: { id: true, name: true, agent: { select: { email: true } } } },
        },
      },
    },
  })
  if (!request) return

  // Who we wrote to when we asked for the card is who we write to now. The
  // booking's own contact is the fallback for a request that was never sent
  // (a client who opened the form from their job portal themselves).
  const to = (request.sentTo || request.booking?.person?.email || '').trim()
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error(`[card-declined-email] no usable address for ${token.slice(0, 8)} — not sent`)
    return
  }

  // The quiet window, kept in the AuditLog rather than a column — the same
  // "sent is an audit row" pattern the job welcome uses. Read BEFORE the
  // send and written after, so three cards in one sitting produce one email.
  const since = new Date(Date.now() - QUIET_MIN * 60_000)
  const already = await prisma.auditLog.count({
    where: {
      action: AUDIT_ACTION,
      entityType: 'PaperworkRequest',
      entityId: request.id,
      createdAt: { gte: since },
    },
  })
  if (already > 0) return

  const { subject, html, text } = buildCardDeclinedEmail({
    firstName: request.booking?.person?.firstName ?? null,
    jobName: request.booking?.job?.name ?? request.booking?.jobName ?? null,
    last4: request.ccCardLast4,
    link: portalV2Url(token),
  })

  // On the job's one thread when the paperwork hangs off a job, so the
  // client sees it in the conversation they already have with us rather than
  // as a stray message (Wes 2026-09-17). Reply-To is the job's agent — a
  // reply to this is "can I pay another way", which is a person's question.
  const sent = await sendOnJobThread({
    jobId: request.booking?.job?.id ?? request.booking?.jobId ?? null,
    to: [to],
    replyTo: request.booking?.job?.agent?.email ?? undefined,
    subject,
    html,
    text,
    label: 'card-declined-client',
  })

  if (!sent.ok) {
    console.error(
      `[card-declined-email] NOT delivered to ${to} for ${token.slice(0, 8)}: ${sent.reason ?? 'unknown'}`,
    )
    return
  }

  // Stamped only on a real send, so a failed attempt does not spend the
  // hour — the opposite of the desk alert, which stamps first because a
  // repeated alert to staff is worse than a missed one. Here a missed email
  // is the whole failure being fixed.
  await prisma.auditLog
    .create({
      data: {
        action: AUDIT_ACTION,
        entityType: 'PaperworkRequest',
        entityId: request.id,
        newValues: { to, last4: request.ccCardLast4, jobId: request.booking?.jobId ?? null },
      },
    })
    .catch((err) => console.error('[card-declined-email] audit write failed', request.id, err))
}
