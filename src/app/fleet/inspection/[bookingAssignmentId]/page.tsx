/**
 * /fleet/inspection/[bookingAssignmentId] — Sprint 2A pre-rental
 * inspection checkout. Mobile-first single column, linked from the
 * fleet-readiness digests.
 *
 * SERVER component: the role gate (ADMIN / MANAGER / DISPATCHER /
 * FLEET_TECH) runs here, not in the UI — AGENT/CLIENT get a 403 body
 * with no inspection data fetched. Lives OUTSIDE the (dashboard) group
 * on purpose: no desktop chrome on a phone in the yard, and the route
 * is not in the tsx/orders middleware allow-lists so it only resolves
 * on the hq host.
 *
 * Chrome comes from the shared yard kit (components/fleet/yard-ui) so
 * this, /fleet/pickup and /fleet/return read as one arc.
 */

import { CheckCircle2, ArrowRight, SearchX } from 'lucide-react'
import { getFleetInspectionUser } from '@/lib/fleet/requireFleetInspectionAccess'
import { prisma } from '@/lib/prisma'
import { InspectionCheckoutForm } from '@/components/fleet/InspectionCheckoutForm'
import { YardHeader, YardNotice, YardOutcome, YardShell, fmtYardWhen, yardBtnPrimary } from '@/components/fleet/yard-ui'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ bookingAssignmentId: string }> }

export default async function FleetInspectionPage({ params }: Params) {
  const { bookingAssignmentId } = await params
  const user = await getFleetInspectionUser()

  if (!user) {
    return (
      <YardNotice title="Fleet access required">
        Pre-rental inspections are limited to fleet staff (admin, manager, dispatcher, fleet tech). Sign in at{' '}
        <a className="text-amber-400 underline" href="/login">hq.sirreel.com/login</a> with a fleet account.
      </YardNotice>
    )
  }

  const assignment = await prisma.bookingAssignment.findUnique({
    where: { id: bookingAssignmentId },
    select: {
      id: true,
      startDate: true,
      asset: {
        select: {
          unitName: true,
          make: true,
          model: true,
          licensePlate: true,
          category: { select: { name: true } },
        },
      },
      bookingItem: {
        select: {
          booking: {
            select: {
              bookingNumber: true,
              jobName: true,
              company: { select: { name: true } },
            },
          },
        },
      },
      inspections: {
        where: { type: 'CHECKOUT' },
        select: {
          id: true, inspectionDate: true,
          inspectedByUser: { select: { name: true } },
          inspectedByDriver: { select: { firstName: true, lastName: true } },
        },
        take: 1,
      },
    },
  })

  if (!assignment) {
    return (
      <YardNotice icon={SearchX} title="Booking assignment not found">
        The link may be stale. Open the unit from <a className="text-amber-400 underline" href="/yard">today&rsquo;s board</a>.
      </YardNotice>
    )
  }

  const booking = assignment.bookingItem.booking
  const existing = assignment.inspections[0] ?? null
  const pickupHref = `/fleet/pickup/${assignment.id}`

  return (
    <YardShell padBottom={!existing}>
      <YardHeader
        step="inspection"
        eyebrow="Pre-rental inspection"
        vehicle={assignment.asset}
        booking={{ jobName: booking.jobName, company: booking.company?.name, bookingNumber: booking.bookingNumber }}
        dateLabel="Out"
        date={assignment.startDate}
      />

      {existing ? (
        <YardOutcome
          icon={CheckCircle2}
          title="Inspection already completed"
          actions={
            // The walkaround's actual next step: the driver turns up and the
            // keys move. Without this the handover screen has no entry point
            // and a rep would have to be handed the URL.
            <a href={pickupHref} className={yardBtnPrimary}>
              Hand over to driver
              <ArrowRight size={16} aria-hidden />
            </a>
          }
        >
          <p>
            {fmtYardWhen(existing.inspectionDate)} by{' '}
            {existing.inspectedByUser?.name ||
              (existing.inspectedByDriver
                ? `${existing.inspectedByDriver.firstName} ${existing.inspectedByDriver.lastName}`.trim() + ' (driver, self check-out)'
                : 'fleet')}
          </p>
        </YardOutcome>
      ) : (
        <InspectionCheckoutForm bookingAssignmentId={assignment.id} pickupHref={pickupHref} />
      )}
    </YardShell>
  )
}
