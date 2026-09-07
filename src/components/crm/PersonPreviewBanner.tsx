/**
 * The strip above a person-portal preview: where you are, whose eyes you
 * are looking through, and the way back. Same shape as the company /
 * vendor / driver preview banners on /crm/portals/preview/*.
 */

import Link from 'next/link'
import { ArrowLeft, Eye } from 'lucide-react'

export function PersonPreviewBanner({
  personId,
  name,
  email,
}: {
  personId: string
  name: string
  email: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/crm/portals#client" className="inline-flex items-center gap-1.5 text-sm text-lt-fg2 hover:text-lt-fg">
          <ArrowLeft className="w-4 h-4" /> Portals
        </Link>
        <Link href={`/crm/people/${personId}`} className="text-sm text-lt-fg2 hover:text-lt-fg">
          Person page →
        </Link>
      </div>
      <div className="rounded-xl border border-amber-300 bg-chip-warn-bg text-chip-warn-fg px-4 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-2">
          <Eye className="w-4 h-4 shrink-0" />
          <span>
            <strong>Preview</strong> — exactly what <strong>{name || email}</strong> sees when they sign
            in to their portal. Buttons are inert here, and this look does not count as a sign-in.
          </span>
        </span>
      </div>
    </div>
  )
}
