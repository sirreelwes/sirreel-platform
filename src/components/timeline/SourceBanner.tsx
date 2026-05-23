'use client'

import type { TimelineSource } from '@/lib/timeline/source'

/**
 * Banner that appears only on the legacy Planyo reference view
 * (`?source=planyo`) — native is the default operational source as
 * of the Chunk 8 PR1 cutover. The banner reminds the operator they
 * are NOT looking at the live book; writes from this view aren't
 * possible.
 */
export function SourceBanner({ source }: { source: TimelineSource }) {
  if (source !== 'planyo') return null
  return (
    <div className="inline-flex items-center gap-2 text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200 rounded px-2 py-1">
      <span className="font-mono uppercase tracking-wide">source: planyo (reference)</span>
      <span className="text-amber-700">read-only — live bookings live in native</span>
    </div>
  )
}
