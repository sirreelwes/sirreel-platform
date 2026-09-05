import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { UnitForm } from '@/components/hq-white-label/UnitForm'
import { PAGE, PageHead } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

export default async function NewUnitPage({ params }: { params: { token: string } }) {
  await requireWorkspace(params.token)
  return (
    <div className={`${PAGE} max-w-[760px]`}>
      <PageHead title="Add a unit" sub="It goes on the calendar and the booking form the moment you save." />
      <UnitForm base={basePath(params.token)} token={params.token} />
    </div>
  )
}
