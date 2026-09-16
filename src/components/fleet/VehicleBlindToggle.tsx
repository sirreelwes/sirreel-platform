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

export function VehicleBlindToggle({
  orders,
  kind,
  kinds,
  tone = 'light',
  className = 'mt-1.5',
}: {
  orders: BlindOrder[]
  /** One edge — the check list shows the lane it is on. */
  kind?: BlindKind
  /** Or both, which is what the handover screen shows: the rep finding
   *  out nobody is meeting the driver is the moment either can change. */
  kinds?: BlindKind[]
  tone?: 'light' | 'dark'
  className?: string
}) {
  const router = useRouter()
  return (
    <BlindHandoffToggles
      orders={orders}
      canEdit
      kinds={kinds ?? (kind ? [kind] : undefined)}
      size="md"
      tone={tone}
      className={className}
      onChanged={() => router.refresh()}
    />
  )
}
