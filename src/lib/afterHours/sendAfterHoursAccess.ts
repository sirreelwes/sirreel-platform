/**
 * Release a job's after-hours instructions to the client, and email them
 * the link.
 *
 * Two facts, deliberately separate (see Job.afterHoursReleasedAt):
 *   RELEASE — the client's portal page starts answering for this job.
 *   SEND    — an email goes out with the link. Re-sendable any number of
 *             times, to a different contact each time if the production
 *             changes coordinators, without touching the release.
 *
 * A send always implies a release: an agent who mails somebody the link
 * plainly meant them to be able to open it. A release without a send is
 * also useful — an agent on the phone can release, then read the client
 * the codes off the HQ card, and the client's portal page is there when
 * the driver asks the same question at 5am.
 *
 * The link goes to ONE order's portal slug even though the release is
 * job-level. That is not a compromise: the portal session is per-order,
 * so the token has to name one, and the page reads the release off the
 * order's job. Any of the job's orders would land the same page.
 */

import { prisma } from '@/lib/prisma'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobAfterHoursUrl } from '@/lib/portal/portalUrl'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { withTeamCc, agentReplyTo } from '@/lib/email/teamVisibility'
import { buildAfterHoursEmail } from '@/lib/email/templates/afterHoursAccess'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type AfterHoursSendFailure =
  | 'job_not_found'
  | 'no_portal_order'
  | 'no_contact'
  | 'send_failed'

export interface AfterHoursSendResult {
  ok: boolean
  reason?: AfterHoursSendFailure
  /** Present on failure — an operator-readable sentence with the fix in it. */
  message?: string
  sentTo?: string
  contactName?: string | null
  link?: string
}

/**
 * Which order carries the link. Prefer one that is actually live, newest
 * first; fall back to any order with a slug so a wrapped job can still be
 * re-sent to a driver returning gear late.
 */
const DEAD_ORDER_STATUSES = ['CANCELLED', 'CLOSED'] as const

export async function sendAfterHoursAccess(args: {
  jobId: string
  /** Staff user releasing/sending — stamped on the job and the audit row. */
  userId: string | null
  /** Override recipient. Defaults to the job's primary contact. */
  personId?: string | null
  /** Agent's per-job line. `undefined` leaves any stored note alone;
   *  a string (including '') replaces it. */
  note?: string | null
}): Promise<AfterHoursSendResult> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: {
      id: true,
      name: true,
      afterHoursNote: true,
      afterHoursReleasedAt: true,
      agent: { select: { name: true, email: true, phone: true } },
      orders: {
        select: { id: true, portalSlug: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
      jobContacts: {
        select: {
          role: true,
          isPrimary: true,
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  })
  if (!job) return { ok: false, reason: 'job_not_found', message: 'Job not found.' }

  const withSlug = job.orders.filter((o) => !!o.portalSlug)
  const order =
    withSlug.find((o) => !DEAD_ORDER_STATUSES.includes(o.status as never)) ?? withSlug[0]
  if (!order?.portalSlug) {
    return {
      ok: false,
      reason: 'no_portal_order',
      message:
        'This job has no order with a client portal yet. Create or send a quote first — the after-hours page lives inside the portal.',
    }
  }

  // Recipient: an explicit pick, else the job's primary contact, else the
  // first contact who can actually receive mail. An address that bounces
  // is not a recipient, so unmailable rows are filtered BEFORE the ladder
  // rather than after — otherwise a PM with a typo'd email wins the
  // ladder and the send fails on a job that had three good addresses.
  const mailable = job.jobContacts.filter((c) => EMAIL_RE.test(c.person.email || ''))
  const chosen = args.personId
    ? mailable.find((c) => c.person.id === args.personId) ?? null
    : pickPrimaryContact(mailable)
  if (!chosen) {
    return {
      ok: false,
      reason: 'no_contact',
      message: args.personId
        ? 'That contact has no valid email address on file.'
        : 'No contact on this job has a valid email address. Add one first.',
    }
  }

  const note = args.note === undefined ? job.afterHoursNote : args.note?.trim() || null

  const issued = await refreshOrIssueJobMagicLink({
    orderId: order.id,
    contactId: chosen.person.id,
  })
  const link = portalJobAfterHoursUrl(order.portalSlug, issued.token)

  const tpl = buildAfterHoursEmail({
    firstName: chosen.person.firstName,
    projectName: job.name,
    link,
    note,
    repName: job.agent?.name || null,
    repPhone: job.agent?.phone || null,
    repEmail: job.agent?.email || null,
  })

  const cc = await withTeamCc([], chosen.person.email)
  const result = await sendAgreementEmail({
    label: 'job/after-hours',
    to: [chosen.person.email],
    cc: cc.length ? cc : undefined,
    // The client will reply to this with "which container?" — that has to
    // reach the rep who sent it, not the unmonitored notifications@ box.
    replyTo: agentReplyTo(job.agent?.email) ?? undefined,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    orderId: order.id,
  })

  if (!result.ok) {
    return {
      ok: false,
      reason: 'send_failed',
      message: 'Could not send the after-hours email. Please try again.',
    }
  }

  const now = new Date()
  await prisma.job.update({
    where: { id: job.id },
    data: {
      afterHoursReleasedAt: job.afterHoursReleasedAt ?? now,
      afterHoursReleasedById: job.afterHoursReleasedAt ? undefined : args.userId,
      afterHoursSentAt: now,
      afterHoursSentTo: chosen.person.email,
      afterHoursNote: note,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: args.userId,
      action: 'job.after_hours_sent',
      entityType: 'job',
      entityId: job.id,
      // Never the codes. The point of the release is that the codes live
      // in exactly one place and can be changed there.
      newValues: {
        sentTo: chosen.person.email,
        orderId: order.id,
        firstRelease: !job.afterHoursReleasedAt,
        hasNote: !!note,
      },
    },
  })

  return {
    ok: true,
    sentTo: chosen.person.email,
    contactName:
      [chosen.person.firstName, chosen.person.lastName]
        .filter((s) => s && s !== '—')
        .join(' ')
        .trim() || null,
    link,
  }
}

/** Release without emailing — the agent-on-the-phone path. */
export async function releaseAfterHours(args: {
  jobId: string
  userId: string | null
  note?: string | null
}): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: { afterHoursReleasedAt: true, afterHoursNote: true },
  })
  if (!job) return
  await prisma.job.update({
    where: { id: args.jobId },
    data: {
      afterHoursReleasedAt: job.afterHoursReleasedAt ?? new Date(),
      afterHoursReleasedById: job.afterHoursReleasedAt ? undefined : args.userId,
      afterHoursNote: args.note === undefined ? job.afterHoursNote : args.note?.trim() || null,
    },
  })
  if (!job.afterHoursReleasedAt) {
    await prisma.auditLog.create({
      data: {
        userId: args.userId,
        action: 'job.after_hours_released',
        entityType: 'job',
        entityId: args.jobId,
        newValues: { emailed: false },
      },
    })
  }
}

/**
 * Revoke. The client's page stops answering immediately — the whole
 * reason this is a release rather than an attachment.
 */
export async function revokeAfterHours(args: {
  jobId: string
  userId: string | null
}): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: { afterHoursReleasedAt: true },
  })
  if (!job?.afterHoursReleasedAt) return
  await prisma.job.update({
    where: { id: args.jobId },
    data: { afterHoursReleasedAt: null, afterHoursReleasedById: null },
  })
  await prisma.auditLog.create({
    data: {
      userId: args.userId,
      action: 'job.after_hours_revoked',
      entityType: 'job',
      entityId: args.jobId,
      oldValues: { releasedAt: job.afterHoursReleasedAt.toISOString() },
    },
  })
}
