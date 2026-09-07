/**
 * /crm/portals/preview/person/[personId]/job/[jobId] — what one PERSON
 * sees when they open a show from their portal home. Reached from the
 * show cards inside the person preview. Nothing stamped; PDFs via the
 * staff routes.
 */
import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/portal/companyPreview'
import { findAttachedJob } from '@/lib/portal/personJobAccess'
import { buildCompanyJobDetail } from '@/lib/portal/companyJobDetail'
import { prisma } from '@/lib/prisma'
import { CompanyPortalJobView } from '@/components/portal/company/CompanyPortalJobView'
import { PersonPreviewBanner } from '@/components/crm/PersonPreviewBanner'

export const dynamic = 'force-dynamic'

export default async function PersonPortalJobPreviewPage({
  params,
}: {
  params: { personId: string; jobId: string }
}) {
  if (!(await requireStaff())) redirect('/login')

  const [person, access] = await Promise.all([
    prisma.person.findUnique({
      where: { id: params.personId },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
    findAttachedJob(params.personId, params.jobId),
  ])
  if (!person || !access) notFound()

  const [job, company] = await Promise.all([
    buildCompanyJobDetail(access.companyId, access.jobId),
    prisma.company.findUnique({ where: { id: access.companyId }, select: { name: true } }),
  ])
  if (!job || !company) notFound()

  const name = `${person.firstName} ${person.lastName}`.trim()

  return (
    <div className="space-y-4">
      <PersonPreviewBanner personId={person.id} name={name} email={person.email} />
      <div className="rounded-2xl border border-lt-hairline overflow-hidden">
        <CompanyPortalJobView
          companyId={access.companyId}
          companyName={company.name}
          job={job}
          preview
          links={{ home: `/crm/portals/preview/person/${person.id}`, homeLabel: 'Their portal' }}
        />
      </div>
    </div>
  )
}
