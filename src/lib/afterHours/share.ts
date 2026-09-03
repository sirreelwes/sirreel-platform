/**
 * Forwarding the after-hours run to whoever is actually driving.
 *
 * Wes, 2026-09-02: "most of the time they are sending this to their truck
 * driver or PA." Before this the only way to do that was to forward the
 * email — which, if the email had carried the client's portal link, would
 * have handed a subcontracted driver the production's quote and invoice.
 *
 * So a share is its own credential, minted per recipient, scoped to one
 * page, with a short life. Resolution is deliberately strict and returns a
 * single opaque failure to the route: a token that is expired, revoked,
 * belongs to a job whose release was pulled, or was never real, all look
 * identical from outside.
 */

import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { portalBaseUrl } from '@/lib/portal/portalUrl'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildAfterHoursShareEmail } from '@/lib/email/templates/afterHoursShare'

/** A run is a night, not a quarter. */
export const SHARE_TTL_DAYS = 14

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function afterHoursShareUrl(token: string): string {
  return `${portalBaseUrl()}/after-hours/${encodeURIComponent(token)}`
}

export type ShareFailure = 'bad_email' | 'not_released' | 'job_not_found' | 'send_failed'

export interface ShareResult {
  ok: boolean
  reason?: ShareFailure
  message?: string
  email?: string
  expiresAt?: Date
}

/**
 * Mint (or refresh) a share for one recipient and email it.
 *
 * Re-sharing to the same address REUSES the existing live token and pushes
 * its expiry out, rather than minting a second. A coordinator who sends it
 * twice because the driver "didn't get it" should not leave two live
 * credentials behind, and the driver who opens the older mail should not
 * find a dead link.
 */
export async function shareAfterHours(args: {
  jobId: string
  email: string
  recipientName?: string | null
  message?: string | null
  senderName?: string | null
  /** Set when the client minted it from their own portal session. */
  sharedByPortalAccessId?: string | null
  /** Set when staff minted it from the job page. */
  sharedByUserId?: string | null
}): Promise<ShareResult> {
  const email = (args.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return { ok: false, reason: 'bad_email', message: 'That does not look like an email address.' }
  }

  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: { id: true, name: true, afterHoursReleasedAt: true },
  })
  if (!job) return { ok: false, reason: 'job_not_found', message: 'Job not found.' }
  if (!job.afterHoursReleasedAt) {
    return {
      ok: false,
      reason: 'not_released',
      message: 'After-hours access is not turned on for this project.',
    }
  }

  const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86_400_000)

  const existing = await prisma.afterHoursShare.findFirst({
    where: { jobId: job.id, email, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, token: true },
  })

  const message = args.message?.trim() || null
  const name = args.recipientName?.trim() || null

  let token: string
  if (existing) {
    token = existing.token
    await prisma.afterHoursShare.update({
      where: { id: existing.id },
      data: { expiresAt, name, message },
    })
  } else {
    token = randomBytes(32).toString('base64url')
    await prisma.afterHoursShare.create({
      data: {
        jobId: job.id,
        token,
        email,
        name,
        message,
        expiresAt,
        sharedByPortalAccessId: args.sharedByPortalAccessId || null,
        sharedByUserId: args.sharedByUserId || null,
      },
    })
  }

  const tpl = buildAfterHoursShareEmail({
    recipientName: name,
    senderName: args.senderName || null,
    projectName: job.name,
    link: afterHoursShareUrl(token),
    message,
    expiresInDays: SHARE_TTL_DAYS,
  })

  const result = await sendAgreementEmail({
    label: 'job/after-hours-share',
    to: [email],
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  })
  if (!result.ok) {
    return {
      ok: false,
      reason: 'send_failed',
      message: 'Could not send that email. Please try again.',
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: args.sharedByUserId || null,
      action: 'job.after_hours_shared',
      entityType: 'job',
      entityId: job.id,
      newValues: {
        to: email,
        by: args.sharedByPortalAccessId ? 'client' : 'staff',
        portalAccessId: args.sharedByPortalAccessId || null,
        reused: !!existing,
      },
    },
  })

  return { ok: true, email, expiresAt }
}

export interface ResolvedShare {
  jobId: string
  jobName: string
  /** The sender's note to this recipient. */
  message: string | null
  /** The agent's per-job line — the driver needs it as much as the client. */
  jobNote: string | null
  recipientName: string | null
  expiresAt: Date
}

/**
 * Resolve a share token for reading. Returns null for every kind of
 * failure — expired, revoked, unknown, or a job whose release was pulled —
 * because distinguishing them for an unauthenticated caller tells a
 * stranger which tokens once existed.
 *
 * Stamps the view. A share that has never been opened is a driver who
 * never got the email, which is worth being able to see.
 */
export async function resolveAfterHoursShare(token: string): Promise<ResolvedShare | null> {
  if (!token || token.length < 20) return null
  const row = await prisma.afterHoursShare.findUnique({
    where: { token },
    select: {
      id: true,
      name: true,
      message: true,
      expiresAt: true,
      revokedAt: true,
      job: { select: { id: true, name: true, afterHoursReleasedAt: true, afterHoursNote: true } },
    },
  })
  if (!row) return null
  if (row.revokedAt) return null
  if (row.expiresAt.getTime() < Date.now()) return null
  if (!row.job?.afterHoursReleasedAt) return null

  await prisma.afterHoursShare.update({
    where: { id: row.id },
    data: { viewedAt: new Date(), viewCount: { increment: 1 } },
  })

  return {
    jobId: row.job.id,
    jobName: row.job.name,
    message: row.message,
    jobNote: row.job.afterHoursNote,
    recipientName: row.name,
    expiresAt: row.expiresAt,
  }
}
