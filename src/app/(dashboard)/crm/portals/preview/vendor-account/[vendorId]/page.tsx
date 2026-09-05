/**
 * /crm/portals/preview/vendor-account/[vendorId] — what the PARTNER sees on
 * their account page. Same body as the public page; nothing is stamped, and
 * unit rows open the HQ preview of that unit rather than the live token.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Eye } from 'lucide-react'
import { requireSubRentalPageAccess } from '@/lib/sub-rentals/previewAccess'
import { loadVendorAccountById } from '@/lib/sub-rentals/vendorAccount'
import { VendorAccountView } from '@/components/site/VendorAccountView'

export const dynamic = 'force-dynamic'

export default async function VendorAccountPreviewPage({ params }: { params: { vendorId: string } }) {
  await requireSubRentalPageAccess()
  const v = await loadVendorAccountById(params.vendorId)
  if (!v) notFound()
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Link href="/crm/portals#vendor" className="text-sm text-lt-fg2 hover:text-lt-fg">← Portals</Link>
      </div>
      <div className="mb-3 rounded-lg border border-chip-warn-fg/30 bg-chip-warn-bg text-chip-warn-fg text-sm px-4 py-2.5 flex items-center gap-2">
        <Eye className="w-4 h-4 shrink-0" />
        <span><strong>Preview</strong> — this is exactly what <strong>{v.vendorName}</strong> sees on their account page. This look does not count as them opening it.</span>
      </div>
      <div className="rounded-xl overflow-hidden border border-lt-hairline">
        <VendorAccountView v={v} token="preview" preview />
      </div>
    </div>
  )
}
