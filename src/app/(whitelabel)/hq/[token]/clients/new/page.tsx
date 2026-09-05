import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { ClientForm } from '@/components/hq-white-label/ClientForm'
import { PAGE, PageHead } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

export default async function NewClientPage({ params }: { params: { token: string } }) {
  await requireWorkspace(params.token)
  return (
    <div className={`${PAGE} max-w-[760px]`}>
      <PageHead title="Add a client" />
      <ClientForm base={basePath(params.token)} token={params.token} />
    </div>
  )
}
