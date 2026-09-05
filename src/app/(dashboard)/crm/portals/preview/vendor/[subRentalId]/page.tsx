/**
 * /crm/portals/preview/vendor/[subRentalId] — what the PARTNER sees.
 *
 * Wes 2026-09-05: "in each portal that we click on our side, we should be
 * able to see what the portal looks like for the client or the vendor or
 * the driver." This renders the real vendor page body for a real sub-rental,
 * with two differences: the view counter is NOT bumped (an HQ look is not
 * the vendor opening it), and every control is inert.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Eye } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getVendorViewByToken } from '@/lib/sub-rentals/potentialSubRental'
import { requireSubRentalPageAccess } from '@/lib/sub-rentals/previewAccess'
import { VendorPageView } from '@/components/site/VendorPageView'

export const dynamic = 'force-dynamic'

export default async function VendorPreviewPage({ params }: { params: { subRentalId: string } }) {
  await requireSubRentalPageAccess()
  const sub = await prisma.subRental.findUnique({
    where: { id: params.subRentalId },
    select: { vendorToken: true, vendor: { select: { name: true } }, job: { select: { id: true, jobCode: true } }, order: { select: { job: { select: { id: true, jobCode: true } } } } },
  })
  if (!sub) notFound()
  const job = sub.job ?? sub.order?.job ?? null
  const v = sub.vendorToken ? await getVendorViewByToken(sub.vendorToken, { stamp: false }) : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/crm/portals#vendors" className="inline-flex items-center gap-1.5 text-sm text-lt-fg2 hover:text-lt-fg">
          <ArrowLeft className="w-4 h-4" /> Portals
        </Link>
        {job && <Link href={`/jobs/${job.id}#sub-rentals`} className="text-sm text-lt-fg2 hover:text-lt-fg">Job {job.jobCode} →</Link>}
      </div>
      <div className="rounded-xl border border-amber-300 bg-chip-warn-bg text-chip-warn-fg px-4 py-2.5 text-sm flex items-center gap-2">
        <Eye className="w-4 h-4 shrink-0" />
        <span>
          <strong>Preview</strong> — this is exactly what <strong>{sub.vendor.name}</strong> sees on their page. Buttons are disabled here, and this look does not count as them opening it.
        </span>
      </div>
      {v ? (
        <div className="rounded-2xl border border-lt-hairline bg-[#fdfcf9] overflow-hidden">
          <VendorPageView v={v} token={sub.vendorToken!} preview />
        </div>
      ) : (
        <div className="rounded-xl border border-lt-hairline bg-lt-card p-8 text-center text-sm text-lt-fg2">
          No vendor page exists for this sub-rental yet — one is minted when the partner is first notified.
        </div>
      )}
    </div>
  )
}
