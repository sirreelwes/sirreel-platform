import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDeskViewer } from '@/lib/collections/access'
import { DeskActivityPanel } from '@/components/collections/DeskActivityPanel'

/**
 * /collections/desk — the collections desk, live.
 *
 * Gated tighter than /collections itself (ADMIN + BILLING, no address
 * allowlist): charging a card and reading a colleague's day are different
 * permissions. See requireDeskViewer.
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: 'SirReel HQ · Collections desk' }

export default async function CollectionsDeskPage() {
  const user = await requireDeskViewer()
  if (!user) redirect('/collections')

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-lt-fg">Collections desk</h1>
          <p className="text-[12px] text-lt-fg2">
            What the desk is landing — money in, invoices closed and clients
            reached, as it happens.
          </p>
        </div>
        <Link
          href="/collections"
          className="rounded border border-lt-hairline px-3 py-1.5 text-[12px] text-lt-fg2 hover:bg-lt-inner"
        >
          Back to collections
        </Link>
      </div>
      <DeskActivityPanel viewerName={user.name} />
    </div>
  )
}
