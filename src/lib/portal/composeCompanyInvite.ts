/**
 * Pure composer for the company-portal invite — one function behind BOTH
 * the preview and the send, so the rep sees exactly what goes out.
 *
 * Wes 2026-09-11: "next time I'd like to be able to preview and modify the
 * invite email to Nancy and people like her." Same contract as
 * composeCardAuthEmail / composeQuoteEmail: recipient + render in one
 * place, `defaultBody` is the templated prose seeded into the compose box
 * so an edit starts from real copy, and `customBody` replaces that prose
 * while the shell (annual-agreement callout, portal button, sign-off)
 * stays — those are facts about the account, not the rep's to retype.
 *
 * Two variants (Wes 2026-09-16): 'standard', the original, and 'overview',
 * which opens with what SirReel has built and the fact that the account's
 * rates reach every team. The rep picks one in the modal; the composer only
 * passes it through and reports whether the account HAS negotiated rates, so
 * the rates highlight is never a promise nobody made.
 *
 * Never writes. The send route stamps `invitedAt` after Resend accepts.
 */

import { prisma } from '@/lib/prisma'
import {
  defaultCompanyPortalInviteBody,
  renderCompanyPortalInvite,
} from '@/lib/email/templates/companyPortal'
import { findCompanyAnnualCoverage } from '@/lib/orders/annualCoverage'
import { findPendingAnnual } from '@/lib/portal/companyAnnual'
import { listOtherAccessHolders } from '@/lib/portal/grantCompanyAccess'

export interface CompanyInviteCompositionOk {
  ok: true
  to: { email: string; name: string }
  subject: string
  html: string
  text: string
  /** The templated prose, seeded into "edit the message". */
  defaultBody: string
  replyTo: string | null
  repName: string
  companyName: string
  alreadyInvitedAt: string | null
  /** Which invite this is — the modal's picker reflects it back. */
  variant: 'standard' | 'overview'
  /**
   * Whether the account has negotiated rates on file. The overview variant's
   * rates highlight is suppressed without them, and the modal warns the rep
   * so they are not surprised by its absence in the preview.
   */
  hasNegotiatedRates: boolean
}

export type CompanyInviteComposition =
  | CompanyInviteCompositionOk
  | { ok: false; status: number; error: string }

export async function composeCompanyPortalInvite(args: {
  companyId: string
  accessId: string
  /** Absolute origin for the portal link (NEXT_PUBLIC_APP_URL etc.). */
  base: string
  /** The signed-in rep, used when the account has no default agent. */
  fallbackRep: { name: string | null; email: string | null }
  customBody?: string | null
  /** Defaults to 'standard' — every existing caller is unchanged. */
  variant?: 'standard' | 'overview'
}): Promise<CompanyInviteComposition> {
  const variant: 'standard' | 'overview' = args.variant === 'overview' ? 'overview' : 'standard'
  const access = await prisma.companyPortalAccess.findFirst({
    where: { id: args.accessId, companyId: args.companyId },
    select: {
      id: true,
      revokedAt: true,
      invitedAt: true,
      company: { select: { id: true, name: true, defaultAgent: { select: { name: true, email: true } } } },
      person: { select: { firstName: true, lastName: true, email: true } },
    },
  })
  if (!access) return { ok: false, status: 404, error: 'not found' }
  if (access.revokedAt) {
    return { ok: false, status: 400, error: 'That access is revoked — restore it before sending an invite.' }
  }

  const [annual, pending, others, rateCount] = await Promise.all([
    findCompanyAnnualCoverage(access.company.id),
    findPendingAnnual(access.company.id),
    listOtherAccessHolders(access.company.id, access.id),
    // Just "is there a deal", never the figures — see ratesCallout() in
    // companyPortal.ts for why no number reaches the mail.
    prisma.companyRate.count({ where: { companyId: access.company.id } }),
  ])
  const rep = access.company.defaultAgent
  const repName = rep?.name || args.fallbackRep.name || 'Your SirReel rep'
  const repEmail = rep?.email || args.fallbackRep.email || null
  const input = {
    firstName: access.person.firstName,
    companyName: access.company.name,
    portalUrl: `${args.base}/portal/company/${access.company.id}`,
    repName,
    repEmail,
    annualAgreementTitle: annual ? annual.title || annual.originalFilename : null,
    pendingAnnual:
      !annual && pending
        ? { title: pending.title, signUrl: `${args.base}/portal/company/${access.company.id}/sign/annual` }
        : null,
    otherPeople: others,
    variant,
    hasNegotiatedRates: rateCount > 0,
  }
  const defaultBody = defaultCompanyPortalInviteBody(input)
  const custom = (args.customBody ?? '').trim()
  const { subject, html, text } = renderCompanyPortalInvite({
    ...input,
    customBody: custom && custom !== defaultBody.trim() ? custom : null,
  })

  return {
    ok: true,
    to: { email: access.person.email, name: `${access.person.firstName} ${access.person.lastName}`.trim() },
    subject,
    html,
    text,
    defaultBody,
    replyTo: repEmail,
    repName,
    companyName: access.company.name,
    alreadyInvitedAt: access.invitedAt ? access.invitedAt.toISOString() : null,
    variant,
    hasNegotiatedRates: rateCount > 0,
  }
}
