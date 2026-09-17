'use client'

/**
 * The blind-handoff toggle on a /reports/vehicles row and the handover
 * screen. Those pages are server components, so this is the client edge:
 * flip THIS vehicle, then re-read the page so the lane agrees.
 *
 * Julian, 2026-09-15: three vans were set to go out blind and the check
 * list had no way to show it or mark it. Jose, 2026-09-16: it must be
 * possible to mark only SOME of a job's vehicles — so the row writes the
 * unit's own override, not the whole job. Same component and same route
 * as the reservation modal on the board (BlindHandoffToggles), so the two
 * cannot disagree.
 */

import { useRouter } from 'next/navigation'
import { BlindHandoffToggles, type BlindKind, type BlindOrder } from '@/components/schedule/BlindHandoffToggles'

export function VehicleBlindToggle({
  jobId,
  assignmentId,
  effective,
  orders,
  kind,
  kinds,
  tone = 'light',
  className = 'mt-1.5',
}: {
  jobId: string | null
  /** The unit the row is about. */
  assignmentId: string
  /** Its effective answer, computed server-side (lib/fleet/blindHandoff). */
  effective: { blindPickup: boolean; blindReturn: boolean }
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
      jobId={jobId}
      orders={orders}
      vehicle={{ assignmentId, effective }}
      canEdit
      kinds={kinds ?? (kind ? [kind] : undefined)}
      size="md"
      tone={tone}
      className={className}
      onChanged={() => router.refresh()}
    />
  )
}
