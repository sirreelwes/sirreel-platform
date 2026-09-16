/**
 * /vendor/account/[token]/how-it-works — the partnership explained, on the
 * partner's own page (Wes 2026-09-15: "I only want a presentation embedded in
 * page"). Reached from the bar above their people list.
 *
 * Same token, same unlisted/noindex treatment as the account page. It does NOT
 * stamp the open counter: the Portals tab's "opened their page" is about the
 * account page itself, and reading the explainer twice is not two visits.
 */
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { loadVendorAccount } from '@/lib/sub-rentals/vendorAccount'
import { defaultReceiveMethodFor } from '@/lib/sub-rentals/partnerKind'
import { PartnerWalkthrough } from '@/components/site/PartnerWalkthrough'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function PartnerHowItWorksPage({ params }: { params: { token: string } }) {
  const v = await loadVendorAccount(params.token, { stamp: false })
  if (!v) notFound()
  const vendor = await prisma.vendor.findUnique({
    where: { id: v.vendorId },
    select: { partnerKind: true, defaultReceiveMethod: true },
  })
  return (
    <PartnerWalkthrough
      vendorName={v.vendorName}
      kind={v.kind}
      receiveMethod={defaultReceiveMethodFor(null, vendor)}
      sharePercent={v.sharePercent}
      maxSharePercent={v.maxSharePercent}
      lotAddress={v.lotAddress}
      exampleUnit={v.fleet[0]?.name ?? null}
      accountPath={`/vendor/account/${params.token}`}
    />
  )
}
