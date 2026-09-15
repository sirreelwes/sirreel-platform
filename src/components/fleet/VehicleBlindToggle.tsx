'use client'

/**
 * The blind-handoff toggle on a /reports/vehicles row. The page is a
 * server component, so this is the client edge: flip the job's live
 * orders, then re-read the page so every row on the same job agrees.
 *
 * Julian, 2026-09-15: three vans were set to go out blind and the check
 * list had no way to show it or mark it. Same write as the reservation
 * modal on the board (BlindHandoffToggles), so the two cannot disagree.
 */

import { useRouter } from 'next/navigation'
import { BlindHandoffToggles, type BlindKind, type BlindOrder } from '@/components/schedule/BlindHandoffToggles'

export function VehicleBlindToggle({ orders, kind }: { orders: BlindOrder[]; kind: BlindKind }) {
  const router = useRouter()
  return (
    <BlindHandoffToggles
      orders={orders}
      canEdit
      kinds={[kind]}
      size="md"
      className="mt-1.5"
      onChanged={() => router.refresh()}
    />
  )
}
