/**
 * The touch-plan runner.
 *
 * Walks every ACTIVE enrolment, works out which step is due, checks the
 * exit conditions, and sends. Called from a cron route.
 *
 * ── Order of operations, which is the whole safety story ───────────
 *
 *   1. Exit conditions FIRST, per enrolment, immediately before any
 *      send. A reply that arrived an hour ago must stop today's step.
 *   2. Then the Phase 2 send guard, which owns suppression, the
 *      sending domain and the daily caps.
 *   3. Only then render and send.
 *
 * Nothing here can send when Phase 2 says no, and nothing here can send
 * to somebody who has already engaged.
 *
 * ── Idempotency ────────────────────────────────────────────────────
 *
 * TouchPlanSend is unique on (enrollmentId, stepId). A cron that fires
 * twice, a retry, or two overlapping runs cannot send the same step
 * twice — the second insert loses to the constraint.
 *
 * ── Only ONE step per enrolment per run ────────────────────────────
 *
 * If a plan was paused for a fortnight, three steps may be "due" at
 * once. Sending all three in one afternoon is how a sequence becomes a
 * complaint. The runner sends the earliest unsent due step and leaves
 * the rest for subsequent runs.
 */

import { prisma } from '@/lib/prisma'
import { EnrollmentExitReason } from '@prisma/client'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { sendGuard, outreachLabel } from '@/lib/outreach/sendGuard'
import { shouldExit } from '@/lib/outreach/exitConditions'
import { renderForRecipient } from '@/lib/outreach/mergeFields'
import { withUnsubscribeFooter } from '@/lib/outreach/campaign'

export interface RunnerResult {
  considered: number
  exited: number
  sent: number
  skipped: number
  failed: number
  completed: number
  blocked?: string
  exitBreakdown: Record<string, number>
}

const DAY_MS = 86_400_000

export async function runTouchPlans(now: Date = new Date()): Promise<RunnerResult> {
  const result: RunnerResult = {
    considered: 0, exited: 0, sent: 0, skipped: 0,
    failed: 0, completed: 0, exitBreakdown: {},
  }

  const enrollments = await prisma.touchPlanEnrollment.findMany({
    where: { status: 'ACTIVE', plan: { isActive: true } },
    select: {
      id: true,
      enrolledAt: true,
      ownerId: true,
      owner: { select: { id: true, name: true, email: true } },
      person: {
        select: {
          id: true, email: true, firstName: true, lastName: true, lastKnownProject: true,
          affiliations: {
            where: { isCurrent: true },
            select: { company: { select: { name: true, lastRentalAt: true } } },
            take: 1,
          },
        },
      },
      plan: { select: { id: true, name: true, steps: { orderBy: { dayOffset: 'asc' } } } },
      sends: { select: { stepId: true } },
    },
  })
  result.considered = enrollments.length
  if (enrollments.length === 0) return result

  for (const e of enrollments) {
    // ── 1. Has this person engaged? Checked before anything else.
    const decision = await shouldExit({
      personId: e.person.id,
      email: e.person.email,
      enrolledAt: e.enrolledAt,
    })
    if (decision.exit) {
      await prisma.touchPlanEnrollment.update({
        where: { id: e.id },
        data: {
          status: 'EXITED',
          exitReason: decision.reason,
          exitDetail: decision.detail ?? null,
          exitedAt: now,
        },
      })
      result.exited += 1
      const key = decision.reason ?? 'UNKNOWN'
      result.exitBreakdown[key] = (result.exitBreakdown[key] ?? 0) + 1
      continue
    }

    // ── 2. Which step is due?
    const sentStepIds = new Set(e.sends.map((s) => s.stepId))
    const elapsedDays = Math.floor((now.getTime() - e.enrolledAt.getTime()) / DAY_MS)
    const due = e.plan.steps.filter((s) => !sentStepIds.has(s.id) && s.dayOffset <= elapsedDays)

    if (due.length === 0) {
      // Nothing due. If every step has been sent, the plan is finished —
      // recorded as PLAN_FINISHED, which is the sequence's least good
      // outcome: it ran the whole way and nobody engaged.
      if (sentStepIds.size >= e.plan.steps.length && e.plan.steps.length > 0) {
        await prisma.touchPlanEnrollment.update({
          where: { id: e.id },
          data: {
            status: 'COMPLETED',
            exitReason: EnrollmentExitReason.PLAN_FINISHED,
            exitedAt: now,
          },
        })
        result.completed += 1
      }
      continue
    }

    // Earliest due step only — never a burst.
    const step = due[0]

    // ── 3. Render. A merge token with no value blocks THIS step, not
    // the enrolment: a later step with simpler copy may still land.
    const rendered = renderForRecipient(step.subject, step.bodyTemplate, {
      firstName: e.person.firstName,
      lastName: e.person.lastName,
      companyName: e.person.affiliations[0]?.company.name ?? null,
      lastKnownProject: e.person.lastKnownProject,
      companyLastRentalAt: e.person.affiliations[0]?.company.lastRentalAt ?? null,
      senderName: e.owner.name ?? null,
    })
    if (!rendered.ok) {
      await prisma.touchPlanSend.create({
        data: {
          enrollmentId: e.id,
          stepId: step.id,
          error: `Could not personalise: no ${rendered.missing.join(', ')}`,
        },
      }).catch(() => undefined)
      result.skipped += 1
      continue
    }

    // ── 4. Phase 2 guard. Owns suppression, domain and caps.
    const guard = await sendGuard({
      userId: e.ownerId,
      fromAddress: e.owner.email,
      recipients: [e.person.email],
    })
    if (!guard.allowed) {
      // A cap or a closed switch is not a failure of this enrolment —
      // leave it ACTIVE and try again next run. Recorded once, not per
      // enrolment, so the log doesn't fill with the same line.
      result.blocked = guard.message ?? guard.reason
      result.skipped += 1
      continue
    }

    // ── 5. Send.
    const { text, html } = withUnsubscribeFooter(rendered.body, e.person.email)
    const sendResult = await sendAgreementEmail({
      to: [e.person.email],
      subject: rendered.subject,
      html,
      text,
      replyTo: e.owner.email,
      label: outreachLabel(e.ownerId, `plan:${e.plan.id}`),
    })

    if (!sendResult.ok) {
      await prisma.touchPlanSend.create({
        data: { enrollmentId: e.id, stepId: step.id, error: sendResult.reason ?? 'send failed' },
      }).catch(() => undefined)
      result.failed += 1
      continue
    }

    await prisma.touchPlanSend.create({
      data: {
        enrollmentId: e.id,
        stepId: step.id,
        sentAt: now,
        resendMessageId: sendResult.id ?? null,
      },
    })

    if (sendResult.id) {
      await recordEmailDelivery({
        resendMessageId: sendResult.id,
        toAddress: e.person.email,
        subject: rendered.subject,
        label: outreachLabel(e.ownerId, `plan:${e.plan.id}`),
      })
    }

    // Lands on the contact timeline like every other touch, so a rep
    // opening the contact sees the sequence rather than being surprised
    // by a reply to a mail they never knew went out.
    await prisma.outreachActivity.create({
      data: {
        type: 'EMAIL',
        personId: e.person.id,
        notes: `${e.plan.name} — step ${step.dayOffset === 0 ? 1 : `day ${step.dayOffset}`}: ${rendered.subject}`,
        occurredAt: now,
        createdById: e.ownerId,
      },
    })
    result.sent += 1
  }

  return result
}
