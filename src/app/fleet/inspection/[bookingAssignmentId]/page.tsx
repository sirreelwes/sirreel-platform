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
 */

import { getFleetInspectionUser } from '@/lib/fleet/requireFleetInspectionAccess'
import { prisma } from '@/lib/prisma'
import { InspectionCheckoutForm } from '@/components/fleet/InspectionCheckoutForm'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ bookingAssignmentId: string }> }

export default async function FleetInspectionPage({ params }: Params) {
  const { bookingAssignmentId } = await params
  const user = await getFleetInspectionUser()

  if (!user) {
    return (
      <main className="min-h-screen bg-zinc-900 flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="text-white text-lg font-semibold mb-2">Fleet access required</h1>
          <p className="text-zinc-400 text-sm">
            Pre-rental inspections are limited to fleet ops (admin, manager, dispatcher, fleet tech).
            Sign in at <a className="text-amber-500 underline" href="/login">hq.sirreel.com/login</a> with a fleet account.
          </p>
        </div>
      </main>
    )
  }

  const assignment = await prisma.bookingAssignment.findUnique({
    where: { id: bookingAssignmentId },
    select: {
      id: true,
      startDate: true,
      endDate: true,
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
        select: { id: true, inspectionDate: true, inspectedByUser: { select: { name: true } } },
        take: 1,
      },
    },
  })

  if (!assignment) {
    return (
      <main className="min-h-screen bg-zinc-900 flex items-center justify-center p-6">
        <p className="text-zinc-400 text-sm">Booking assignment not found.</p>
      </main>
    )
  }

  const booking = assignment.bookingItem.booking
  const existing = assignment.inspections[0] ?? null

  return (
    <main className="min-h-screen bg-zinc-900 px-4 py-6">
      <div className="max-w-md mx-auto">
        <header className="mb-5">
          <div className="text-amber-500 text-xs font-semibold uppercase tracking-wide mb-1">Pre-rental inspection</div>
          <h1 className="text-white text-xl font-bold">
            Unit {assignment.asset.unitName}
            <span className="text-zinc-400 font-normal"> · {assignment.asset.category.name}</span>
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            {booking.jobName} — {booking.company.name} ({booking.bookingNumber})
          </p>
          <p className="text-zinc-500 text-xs mt-0.5">
            {[assignment.asset.make, assignment.asset.model].filter(Boolean).join(' ')}
            {assignment.asset.licensePlate ? ` · ${assignment.asset.licensePlate}` : ''}
            {' · out '}{assignment.startDate.toISOString().slice(0, 10)}
          </p>
        </header>

        {existing ? (
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-5 text-center">
            <div className="text-3xl mb-2">✅</div>
            <p className="text-white font-semibold">Inspection already completed</p>
            <p className="text-zinc-400 text-sm mt-1">
              {existing.inspectionDate.toISOString().slice(0, 16).replace('T', ' ')} by {existing.inspectedByUser.name || 'fleet'}
            </p>
          </div>
        ) : (
          <InspectionCheckoutForm bookingAssignmentId={assignment.id} />
        )}
      </div>
    </main>
  )
}
