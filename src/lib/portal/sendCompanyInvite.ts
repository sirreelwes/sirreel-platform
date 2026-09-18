/**
 * Send (or re-send) the account-portal invite — ONE sender, two callers.
 *
 * This was inline in `PATCH /api/crm/companies/[id]/portal-access/[accessId]`
 * and nothing else could reach it, so the phone could not invite anybody. It
 * is extracted rather than copied because of what the invite CARRIES: the
 * annual-agreement callout and the link to the signing page are rendered by
 * `composeCompanyPortalInvite` and appended by the template, not by the
 * editable prose (the partner-welcome rule). A second sender is a second
 * place for that link to go missing.
 *
 * The EMAIL IS THE ACT: `invitedAt` is stamped only after Resend accepts, so
 * a failed send leaves the row reading "Not invited yet" rather than lying
 * about a mail nobody got.
 */

import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { composeCompanyPortalInvite } from '@/lib/portal/composeCompanyInvite'

/** The HQ origin an emailed link has to resolve from, for a caller with no
 *  request to read it off (a maintenance task, a script). */
export function hqOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
}

export type SendCompanyInviteResult =
  | { ok: true; to: string; subject: string }
  | { ok: false; status: number; error: string }

export async function sendCompanyPortalInvite(args: {
  companyId: string
  accessId: string
  /** Absolute origin for the portal link. */
  base: string
  /** Used when the account has no default agent. */
  fallbackRep: { name: string | null; email: string | null }
  /** The rep's edited prose, when there is any. The shell stays either way. */
  customBody?: string | null
  /** Who pressed it, for the audit row. */
  byUserId: string | null
}): Promise<SendCompanyInviteResult> {
  const composition = await composeCompanyPortalInvite({
    companyId: args.companyId,
    accessId: args.accessId,
    base: args.base,
    fallbackRep: args.fallbackRep,
    customBody: args.customBody ?? null,
  })
  if (!composition.ok) return { ok: false, status: composition.status, error: composition.error }

  const result = await sendAgreementEmail({
    to: [composition.to.email],
    replyTo: composition.replyTo || undefined,
    subject: composition.subject,
    html: composition.html,
    text: composition.text,
    label: 'company-portal-invite',
  })
  if (!result.ok) return { ok: false, status: 502, error: result.reason || 'Send failed' }

  await prisma.companyPortalAccess.update({
    where: { id: args.accessId },
    data: { invitedAt: new Date() },
  })
  await prisma.auditLog
    .create({
      data: {
        action: 'company_portal.invite_sent',
        entityType: 'company',
        entityId: args.companyId,
        userId: args.byUserId,
        newValues: {
          accessId: args.accessId,
          to: composition.to.email,
          customBody: !!(args.customBody ?? '').trim(),
        },
      },
    })
    .catch(() => null)

  return { ok: true, to: composition.to.email, subject: composition.subject }
}
