/**
 * Exit conditions — when a sequence must stop.
 *
 * This is the most important file in Phase 4. A multi-step sequence that
 * keeps sending after someone has replied is not a sales tool, it is a
 * machine for annoying the exact people who just showed interest. Every
 * one of these is checked IMMEDIATELY BEFORE each send, not on a nightly
 * schedule, because the gap between "they replied" and "we sent step 3"
 * is measured in the recipient's patience.
 *
 * ── The conditions ─────────────────────────────────────────────────
 *
 *   REPLIED    any inbound mail from their address since enrolment.
 *              The sequence worked; get out of the way. This is the
 *              outcome we WANT, and it is counted as a success.
 *   INQUIRY    an Inquiry row created for them since enrolment. They
 *              came in through a form instead of replying directly.
 *   ORDER      their company raised an order since enrolment. Mailing a
 *              "just checking in" to someone who is actively renting
 *              from us reads as though nobody at SirReel talks to
 *              anybody else.
 *   SUPPRESSED they unsubscribed, bounced, or complained. Non-negotiable.
 *
 * ── Fails closed ───────────────────────────────────────────────────
 *
 * If a check throws, `shouldExit` returns an exit rather than allowing
 * the send. The cost of stopping a sequence wrongly is one email nobody
 * received; the cost of continuing wrongly is mailing someone who told
 * us to stop.
 */

import { prisma } from '@/lib/prisma'
import { EnrollmentExitReason } from '@prisma/client'
import { isSuppressed } from '@/lib/outreach/suppression'

export interface ExitCheckInput {
  personId: string
  email: string
  enrolledAt: Date
}

export interface ExitDecision {
  exit: boolean
  reason?: EnrollmentExitReason
  detail?: string
}

/**
 * Has this person engaged since we enrolled them?
 *
 * Order matters only for which reason gets recorded; any hit stops the
 * sequence. SUPPRESSED is checked first because it is the one with legal
 * weight, and it should be the reason on the record even if they also
 * happened to reply.
 */
export async function shouldExit(input: ExitCheckInput): Promise<ExitDecision> {
  try {
    if (await isSuppressed(input.email)) {
      return {
        exit: true,
        reason: EnrollmentExitReason.SUPPRESSED,
        detail: 'On the suppression list',
      }
    }

    // REPLIED — any inbound mail from them after enrolment. fromAddress
    // is stored as "Name <addr>" as often as bare, hence `contains`.
    const reply = await prisma.emailMessage.findFirst({
      where: {
        direction: 'inbound',
        duplicateOfId: null,
        sentAt: { gt: input.enrolledAt },
        fromAddress: { contains: input.email, mode: 'insensitive' },
      },
      select: { id: true, subject: true, sentAt: true },
      orderBy: { sentAt: 'asc' },
    })
    if (reply) {
      return {
        exit: true,
        reason: EnrollmentExitReason.REPLIED,
        detail: `Replied ${reply.sentAt.toISOString().slice(0, 10)}: ${reply.subject.slice(0, 80)}`,
      }
    }

    // INQUIRY — they came in through a form rather than replying.
    const inquiry = await prisma.inquiry.findFirst({
      where: { createdAt: { gt: input.enrolledAt }, personId: input.personId },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    if (inquiry) {
      return {
        exit: true,
        reason: EnrollmentExitReason.INQUIRY,
        detail: `Inquiry created ${inquiry.createdAt.toISOString().slice(0, 10)}`,
      }
    }

    // ORDER — their company started renting. Checked through current
    // affiliations, since an order belongs to a company, not a contact.
    const order = await prisma.order.findFirst({
      where: {
        createdAt: { gt: input.enrolledAt },
        company: { affiliations: { some: { personId: input.personId, isCurrent: true } } },
      },
      select: { id: true, orderNumber: true },
      orderBy: { createdAt: 'asc' },
    })
    if (order) {
      return {
        exit: true,
        reason: EnrollmentExitReason.ORDER,
        detail: `Order ${order.orderNumber} raised by their company`,
      }
    }

    return { exit: false }
  } catch (err) {
    console.error('[exitConditions] check failed — exiting the enrolment rather than sending:', err)
    return {
      exit: true,
      reason: EnrollmentExitReason.MANUAL,
      detail: 'Could not verify engagement; stopped to be safe',
    }
  }
}
