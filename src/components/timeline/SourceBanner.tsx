'use client'

import type { TimelineSource } from '@/lib/timeline/source'

/**
 * Visible-only-when-native indicator for the gantt / dashboard /
 * calendar views. Reads as a low-key chip on the page header so
 * agents know they're looking at the native source, not Planyo.
 * Renders nothing in the default Planyo case.
 */
export function SourceBanner({ source }: { source: TimelineSource }) {
  if (source !== 'native') return null
  return (
    <div className="inline-flex items-center gap-2 text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200 rounded px-2 py-1">
      <span className="font-mono uppercase tracking-wide">source: native</span>
      <span className="text-blue-600">reading BookingAssignment — Planyo bypassed for this view</span>
    </div>
  )
}
