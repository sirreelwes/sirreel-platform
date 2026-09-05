import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getVendorViewByToken } from '@/lib/sub-rentals/potentialSubRental'
import { VendorPageView } from '@/components/site/VendorPageView'

/**
 * VENDOR page — /vendor/[token]. The partner's own view of a sub-rental of
 * their unit. The page body lives in VendorPageView so HQ can render the
 * identical thing as a preview (/crm/portals/preview/vendor/[id]).
 *
 * Unlisted and noindex for the same reasons as /unit/[token].
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'SirReel — Sub-rental', robots: { index: false, follow: false } }
}

export default async function VendorPage({ params }: { params: { token: string } }) {
  const v = await getVendorViewByToken(params.token)
  if (!v) notFound()
  return <VendorPageView v={v} token={params.token} />
}
