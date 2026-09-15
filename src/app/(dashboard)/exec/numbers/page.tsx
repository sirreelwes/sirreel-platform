import { redirect } from 'next/navigation'
import { requireOwnerViewer } from '@/lib/exec/ownerAccess'
import { buildOwnerNumbers } from '@/lib/exec/ownerNumbersQuery'
import { OwnerNumbersView } from '@/components/exec/OwnerNumbersView'

/**
 * /exec/numbers — sales, orders and collections, for Wes only.
 *
 * The gate is requireOwnerViewer() (an email allowlist, not ADMIN — see
 * src/lib/exec/ownerAllowlist.ts); anyone else is sent to /dashboard. Every
 * definition lives in src/lib/exec/ownerNumbers.ts.
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: 'SirReel HQ · Sales & collections' }

export default async function OwnerNumbersPage() {
  const viewer = await requireOwnerViewer()
  if (!viewer) redirect('/dashboard')

  const data = await buildOwnerNumbers()
  return <OwnerNumbersView data={data} />
}
