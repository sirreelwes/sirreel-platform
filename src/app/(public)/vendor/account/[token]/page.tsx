/**
 * /vendor/account/[token] — the PARTNER's account page: every show with
 * their units on it. Unlisted and noindex like /vendor/[token]; the token
 * is the credential. See src/lib/sub-rentals/vendorAccount.ts.
 */
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { loadVendorAccount } from '@/lib/sub-rentals/vendorAccount'
import { VendorAccountView } from '@/components/site/VendorAccountView'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function VendorAccountPage({ params }: { params: { token: string } }) {
  const v = await loadVendorAccount(params.token, { stamp: true })
  if (!v) notFound()
  return <VendorAccountView v={v} />
}
