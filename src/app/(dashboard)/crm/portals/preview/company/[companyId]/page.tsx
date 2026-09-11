/**
 * /crm/portals/preview/company/[companyId] — what the CLIENT sees in their
 * account portal. Wes 2026-09-06: "a button in our portal page for them and
 * all others to 'see what they see'."
 *
 * Real data, the real body (CompanyPortalView), no view stamp, controls
 * inert. `?as=<accessId>` picks whose eyes.
 */
import { notFound, redirect } from 'next/navigation'
import { buildCompanyOverview } from '@/lib/portal/companyOverview'
import { buildServiceCatalog } from '@/lib/portal/companyServices'
import { buildCompanyPreviewContext, requireStaff } from '@/lib/portal/companyPreview'
import { CompanyPortalView } from '@/components/portal/company/CompanyPortalView'
import { listClientCards } from '@/lib/portal/companyPortalCards'
import { listClientCois } from '@/lib/portal/companyPortalCois'
import { CompanyPreviewBanner } from '@/components/crm/CompanyPreviewBanner'

export const dynamic = 'force-dynamic'

export default async function CompanyPortalPreviewPage({
  params,
  searchParams,
}: {
  params: { companyId: string }
  searchParams: { as?: string }
}) {
  if (!(await requireStaff())) redirect('/login')
  const ctx = await buildCompanyPreviewContext(params.companyId, searchParams.as ?? null)
  if (!ctx) notFound()

  const [overview, services, cards, cois] = await Promise.all([
    buildCompanyOverview(ctx.companyId),
    buildServiceCatalog(),
    listClientCards(ctx.companyId),
    listClientCois(ctx.companyId),
  ])

  return (
    <div className="space-y-4">
      <CompanyPreviewBanner
        companyId={ctx.companyId}
        companyName={ctx.companyName}
        currentAccessId={ctx.persona.accessId}
        personas={ctx.personas}
      />
      <div className="rounded-2xl border border-lt-hairline overflow-hidden">
        <CompanyPortalView
          companyId={ctx.companyId}
          viewer={ctx.persona.viewer}
          overview={overview}
          services={services}
          prefs={ctx.persona.prefs}
          people={ctx.people}
          cards={cards}
          cois={cois}
          preview
        />
      </div>
    </div>
  )
}
