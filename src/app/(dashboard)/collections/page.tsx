import { redirect } from 'next/navigation'
import { requireCollectionsUser } from '@/lib/collections/access'
import { CollectionsWorkspace } from '@/components/collections/CollectionsWorkspace'

/**
 * /collections — take card payments against RentalWorks invoices while
 * billing still lives in RW.
 *
 * Gated to ADMIN + BILLING + an explicit allowlist (see access.ts). The page
 * gate and every API route call the SAME resolver, so a UI mistake can't grant
 * access the endpoints wouldn't.
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: 'SirReel HQ · Collections' }

export default async function CollectionsPage() {
  const user = await requireCollectionsUser()
  if (!user) redirect('/')
  return <CollectionsWorkspace operatorName={user.name} />
}
