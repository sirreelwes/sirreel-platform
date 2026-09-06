/**
 * /portal/company/[companyId]/job/[jobId] — one show's paperwork.
 *
 * The door only; the body is CompanyPortalJobView, shared with HQ's
 * preview so the two cannot drift.
 */

import { notFound, redirect } from 'next/navigation'
import { getCompanyPortalSession } from '@/lib/portal/companyPortal'
import { buildCompanyJobDetail } from '@/lib/portal/companyJobDetail'
import { CompanyPortalJobView } from '@/components/portal/company/CompanyPortalJobView'

export const dynamic = 'force-dynamic'

export default async function CompanyPortalJobPage({
  params,
}: {
  params: { companyId: string; jobId: string }
}) {
  const session = await getCompanyPortalSession(params.companyId)
  // Same door as the company page — see the note there.
  if (!session) redirect(`/portal/company?next=${encodeURIComponent(`/portal/company/${params.companyId}`)}`)

  // companyId comes from the SESSION, not the URL — the two are equal here
  // only because the session resolved against that URL segment.
  const job = await buildCompanyJobDetail(session.companyId, params.jobId)
  if (!job) notFound()

  return (
    <CompanyPortalJobView
      companyId={params.companyId}
      companyName={session.companyName}
      job={job}
    />
  )
}
