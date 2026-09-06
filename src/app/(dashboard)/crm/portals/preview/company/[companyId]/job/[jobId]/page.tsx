/**
 * /crm/portals/preview/company/[companyId]/job/[jobId] — what the client
 * sees when they open one show from their account portal. Reached from the
 * job tiles inside the company preview.
 */
import { notFound, redirect } from 'next/navigation'
import { buildCompanyJobDetail } from '@/lib/portal/companyJobDetail'
import { buildCompanyPreviewContext, requireStaff } from '@/lib/portal/companyPreview'
import { CompanyPortalJobView } from '@/components/portal/company/CompanyPortalJobView'
import { CompanyPreviewBanner } from '@/components/crm/CompanyPreviewBanner'

export const dynamic = 'force-dynamic'

export default async function CompanyPortalJobPreviewPage({
  params,
  searchParams,
}: {
  params: { companyId: string; jobId: string }
  searchParams: { as?: string }
}) {
  if (!(await requireStaff())) redirect('/login')
  const ctx = await buildCompanyPreviewContext(params.companyId, searchParams.as ?? null)
  if (!ctx) notFound()
  const job = await buildCompanyJobDetail(ctx.companyId, params.jobId)
  if (!job) notFound()

  return (
    <div className="space-y-4">
      <CompanyPreviewBanner
        companyId={ctx.companyId}
        companyName={ctx.companyName}
        currentAccessId={ctx.persona.accessId}
        personas={ctx.personas}
        jobHref={`/crm/portals/preview/company/${ctx.companyId}/job/${params.jobId}`}
      />
      <div className="rounded-2xl border border-lt-hairline overflow-hidden">
        <CompanyPortalJobView
          companyId={ctx.companyId}
          companyName={ctx.companyName}
          job={job}
          preview
        />
      </div>
    </div>
  )
}
