/**
 * /crm/portals/preview/driver/[subRentalId] — what the partner's DRIVER sees.
 * Real data, no view stamp, controls inert. Framed at phone width because
 * that is where it is read.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Eye } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { requireSubRentalPageAccess } from '@/lib/sub-rentals/previewAccess'
import { buildDriverUnitView, todayPacific } from '@/lib/sub-rentals/driverUnitView'
import { loadConduit } from '@/lib/sub-rentals/conduit'
import { DriverUnitPageView } from '@/components/drivers/DriverUnitPageView'

export const dynamic = 'force-dynamic'

export default async function DriverPreviewPage({ params }: { params: { subRentalId: string } }) {
  await requireSubRentalPageAccess()
  const exists = await prisma.subRental.findUnique({ where: { id: params.subRentalId }, select: { id: true } })
  if (!exists) notFound()
  const row = await loadConduit(params.subRentalId)
  if (!row) notFound()
  const job = row.job
  const view = row.driverName ? await buildDriverUnitView(row, todayPacific()) : null

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
          <strong>Preview</strong> — what {row.driverName ? <strong>{row.driverName}</strong> : 'the driver'} ({row.vendor.name}) sees on their phone. Buttons are disabled; this look does not count as them opening it.
        </span>
      </div>
      {view ? (
        <div className="max-w-md">
          <DriverUnitPageView token={row.driverToken ?? 'preview'} initialData={view} preview />
        </div>
      ) : (
        <div className="rounded-xl border border-lt-hairline bg-lt-card p-8 text-center text-sm text-lt-fg2">
          {row.vendor.name} hasn&rsquo;t named a driver for this unit yet, so there is no driver page to show.
        </div>
      )}
    </div>
  )
}
