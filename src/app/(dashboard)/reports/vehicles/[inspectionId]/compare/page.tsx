/**
 * /reports/vehicles/[inspectionId]/compare — check-out beside check-in,
 * one angle at a time (Hugo, 2026-09-17). Opened from either end's
 * record page; out is always on the left. The pairing is built in
 * lib/fleet/comparePairs, the viewer is components/fleet/
 * WalkaroundCompare. Read-only, yard-gated, like the record it opens from.
 */

import { notFound } from 'next/navigation'
import { Lock } from 'lucide-react'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { filedInspection } from '@/lib/fleet/inspectionHistory'
import { buildCompareRecord, startIndex } from '@/lib/fleet/comparePairs'
import { WalkaroundCompare } from '@/components/fleet/WalkaroundCompare'

export const dynamic = 'force-dynamic'

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ inspectionId: string }>
  searchParams: Promise<{ slot?: string }>
}) {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-lt-fg3" />
        <h1 className="text-lt-fg text-xl font-semibold mb-2">Yard access required</h1>
        <p className="text-lt-fg2 text-[15px]">
          Vehicle check in/out is for fleet and warehouse staff.
        </p>
      </div>
    )
  }

  const { inspectionId } = await params
  const { slot } = await searchParams
  const rec = await filedInspection(inspectionId)
  if (!rec) notFound()

  const record = buildCompareRecord(rec)
  return (
    <div className="max-w-5xl mx-auto px-1 py-2">
      <WalkaroundCompare
        record={record}
        start={startIndex(record.pairs, slot)}
        backHref={`/reports/vehicles/${inspectionId}`}
      />
    </div>
  )
}
