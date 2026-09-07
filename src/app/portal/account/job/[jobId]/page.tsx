/**
 * /portal/account/job/[jobId] — one show, opened from the PERSON's portal
 * home. Wes 2026-09-07: wrapped shows need a drill-in, not just a row.
 *
 * The body is the company portal's job view (invoices, agreements, who's
 * on it) — same data builder, same render — behind a different gate: the
 * signed-in person must be attached to the job (personJobAccess.ts). PDF
 * links go through the person-scoped twins under /api/portal/account.
 */

import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { PERSON_SESSION_COOKIE, verifyPersonSessionCookieValue } from '@/lib/portal/personSession'
import { getPersonJobAccess, personJobLinks } from '@/lib/portal/personJobAccess'
import { buildCompanyJobDetail } from '@/lib/portal/companyJobDetail'
import { prisma } from '@/lib/prisma'
import { CompanyPortalJobView } from '@/components/portal/company/CompanyPortalJobView'

export const dynamic = 'force-dynamic'

export default async function PersonPortalJobPage({ params }: { params: { jobId: string } }) {
  // No session at all → sign in. A session that isn't attached to this
  // job → 404, never 403.
  if (!verifyPersonSessionCookieValue(cookies().get(PERSON_SESSION_COOKIE)?.value)) {
    redirect('/portal/auth/sign-in')
  }
  const access = await getPersonJobAccess(params.jobId)
  if (!access) notFound()

  const [job, company] = await Promise.all([
    buildCompanyJobDetail(access.companyId, access.jobId),
    prisma.company.findUnique({ where: { id: access.companyId }, select: { name: true } }),
  ])
  if (!job || !company) notFound()

  return (
    <CompanyPortalJobView
      companyId={access.companyId}
      companyName={company.name}
      job={job}
      links={personJobLinks(access.jobId)}
    />
  )
}
