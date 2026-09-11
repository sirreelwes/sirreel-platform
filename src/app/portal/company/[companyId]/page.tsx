/**
 * /portal/company/[companyId] — the production company's account view.
 *
 * The page is the DOOR: it resolves the session, bumps the counters, loads
 * the data, and hands everything to CompanyPortalView — which HQ's
 * "see what they see" preview renders too, so the two can never drift
 * (Wes 2026-09-06). The body and its rulings live in
 * src/components/portal/company/CompanyPortalView.tsx.
 *
 * Authorization is `getCompanyPortalSession` and nothing else; see
 * src/lib/portal/companyPortal.ts for why a miss renders 404.
 */

import { redirect } from 'next/navigation'
import { getCompanyPortalSession } from '@/lib/portal/companyPortal'
import { buildCompanyOverview } from '@/lib/portal/companyOverview'
import { buildServiceCatalog } from '@/lib/portal/companyServices'
import { listCompanyPortalPeople } from '@/lib/portal/grantCompanyAccess'
import { listClientCards } from '@/lib/portal/companyPortalCards'
import { prisma } from '@/lib/prisma'
import { CompanyPortalView } from '@/components/portal/company/CompanyPortalView'

export const dynamic = 'force-dynamic'

export default async function CompanyPortalPage({
  params,
}: {
  params: { companyId: string }
}) {
  const session = await getCompanyPortalSession(params.companyId, { touch: true })
  // A miss goes to the door, not to a 404. Wes 2026-09-04: "I'd rather
  // reply to the email with a link" — so this URL is what a first-time
  // visitor clicks, cold, from a mail thread. /portal/company sends the
  // signed-out to sign-in (and back here after the magic link), and gives
  // the signed-in-but-unlisted an honest explanation. Nothing about the
  // company leaks either way: every miss redirects identically.
  if (!session) redirect(`/portal/company?next=${encodeURIComponent(`/portal/company/${params.companyId}`)}`)

  const [overview, services, access, people, cards] = await Promise.all([
    buildCompanyOverview(params.companyId),
    buildServiceCatalog(),
    prisma.companyPortalAccess.findUnique({
      where: { id: session.accessId },
      select: {
        notifyJobStart: true,
        notifyInvoicePaid: true,
        notifyJobClosed: true,
        notifyQuoteSent: true,
        cadence: true,
      },
    }),
    listCompanyPortalPeople(params.companyId, session.accessId),
    listClientCards(params.companyId),
  ])

  return (
    <CompanyPortalView
      companyId={params.companyId}
      viewer={{
        personName: session.personName,
        personEmail: session.personEmail,
        role: session.role,
        title: session.title,
      }}
      overview={overview}
      services={services}
      prefs={{
        notifyJobStart: access?.notifyJobStart ?? true,
        notifyInvoicePaid: access?.notifyInvoicePaid ?? true,
        notifyJobClosed: access?.notifyJobClosed ?? true,
        notifyQuoteSent: access?.notifyQuoteSent ?? false,
        cadence: access?.cadence ?? 'IMMEDIATE',
      }}
      people={people}
      cards={cards}
    />
  )
}
