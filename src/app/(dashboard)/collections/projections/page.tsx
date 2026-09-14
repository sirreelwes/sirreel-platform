import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCollectionsUser } from '@/lib/collections/access'
import { ProjectionsPanel } from '@/components/collections/ProjectionsPanel'

/**
 * /collections/projections — what should come in, week by week.
 *
 * Ana, 2026-09-14: "Do we have a tool to create weekly collections
 * projections? I can go off RentalWorks for anything made there, but we'll
 * need something going forward."
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: 'SirReel HQ · Collections projections' }

export default async function ProjectionsPage() {
  const user = await requireCollectionsUser()
  if (!user) redirect('/')

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-lt-fg">Collections projections</h1>
          <p className="text-[12px] text-lt-fg2">
            What is due to be billed, and what should land, week by week.
          </p>
        </div>
        <Link
          href="/collections"
          className="rounded border border-lt-hairline px-3 py-1.5 text-[12px] text-lt-fg2 hover:bg-lt-inner"
        >
          Back to collections
        </Link>
      </div>
      <ProjectionsPanel />
    </div>
  )
}
