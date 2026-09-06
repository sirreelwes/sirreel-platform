/**
 * HQ's "see what they see" for the account portal.
 *
 * Wes 2026-09-06: "I'd like a button in our portal page for them and all
 * others to 'see what they see'."
 *
 * The preview renders the real portal body for a real company, AS one of
 * the people who has access — the header strip names them, the "YOU" chip
 * lands on their row, their notification elections show. Nothing is
 * stamped: this never touches the access row, so an HQ look is not "the
 * client opened it" (the first-open alert stays honest).
 *
 * `?as=<accessId>` picks the persona; the default is the earliest live
 * grant. An account with nobody granted yet previews as a placeholder
 * executive, so the page can be checked before the first invite goes out.
 */

import { getServerSession } from 'next-auth'
import type { CompanyPortalRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listCompanyPortalPeople, type CompanyPortalPersonRow } from '@/lib/portal/grantCompanyAccess'
import type { CompanyPortalViewer } from '@/components/portal/company/CompanyPortalView'
import type { NotificationPrefs } from '@/components/portal/company/NotificationSettings'

export interface CompanyPreviewPersona {
  accessId: string | null
  viewer: CompanyPortalViewer
  prefs: NotificationPrefs
}

export interface CompanyPreviewContext {
  companyId: string
  companyName: string
  persona: CompanyPreviewPersona
  /** Everyone who could be previewed as — the switcher in the banner. */
  personas: { accessId: string; name: string; email: string; label: string }[]
  people: CompanyPortalPersonRow[]
}

/** Staff-only. Returns null when not signed in (caller redirects). */
export async function requireStaff(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return { email: session.user.email }
}

export async function buildCompanyPreviewContext(
  companyId: string,
  asAccessId: string | null,
): Promise<CompanyPreviewContext | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true },
  })
  if (!company) return null

  const grants = await prisma.companyPortalAccess.findMany({
    where: { companyId, revokedAt: null },
    orderBy: { grantedAt: 'asc' },
    select: {
      id: true,
      role: true,
      title: true,
      notifyJobStart: true,
      notifyInvoicePaid: true,
      notifyJobClosed: true,
      notifyQuoteSent: true,
      cadence: true,
      person: { select: { firstName: true, lastName: true, email: true } },
    },
  })

  const chosen = (asAccessId && grants.find((g) => g.id === asAccessId)) || grants[0] || null

  const persona: CompanyPreviewPersona = chosen
    ? {
        accessId: chosen.id,
        viewer: {
          personName: `${chosen.person.firstName} ${chosen.person.lastName}`.trim() || chosen.person.email,
          personEmail: chosen.person.email,
          role: chosen.role,
          title: chosen.title,
        },
        prefs: {
          notifyJobStart: chosen.notifyJobStart,
          notifyInvoicePaid: chosen.notifyInvoicePaid,
          notifyJobClosed: chosen.notifyJobClosed,
          notifyQuoteSent: chosen.notifyQuoteSent,
          cadence: chosen.cadence,
        },
      }
    : {
        accessId: null,
        viewer: {
          personName: 'Their executive',
          personEmail: 'nobody granted yet',
          role: 'EXECUTIVE' as CompanyPortalRole,
          title: null,
        },
        prefs: {
          notifyJobStart: true,
          notifyInvoicePaid: true,
          notifyJobClosed: true,
          notifyQuoteSent: false,
          cadence: 'IMMEDIATE',
        },
      }

  return {
    companyId: company.id,
    companyName: company.name,
    persona,
    personas: grants.map((g) => ({
      accessId: g.id,
      name: `${g.person.firstName} ${g.person.lastName}`.trim() || g.person.email,
      email: g.person.email,
      label: g.title || g.role,
    })),
    people: await listCompanyPortalPeople(companyId, persona.accessId),
  }
}
