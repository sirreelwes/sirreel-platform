/**
 * /fleet/pickup/[bookingAssignmentId] — Sprint 2B physical handover.
 *
 * The sibling of /fleet/inspection/[bookingAssignmentId]: the walkaround
 * happens before anyone knows who the production is sending, this is the
 * moment that person turns up and the keys move. Same shape on purpose —
 * SERVER component with the role gate here (not in the UI), mobile-first
 * single column, outside the (dashboard) group so there's no desktop
 * chrome on a phone at the gate, and absent from the tsx/orders
 * middleware allow-lists so it only resolves on the hq host.
 *
 * This screen is where the licence gate is actually enforced in front of
 * a person. Its job is not merely to say no: every blocker it can raise
 * has a fix available right here, because a rep holding up a truck at 6am
 * needs a path forward, not a locked door.
 */

import { getVehicleHandoverUser } from '@/lib/fleet/requireVehicleHandoverAccess'
import { prisma } from '@/lib/prisma'
import { PickupDriverForm } from '@/components/fleet/PickupDriverForm'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ bookingAssignmentId: string }> }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-900 px-4 py-6">
      <div className="max-w-md mx-auto">{children}</div>
    </main>
  )
}

export default async function FleetPickupPage({ params }: Params) {
  const { bookingAssignmentId } = await params
  const user = await getVehicleHandoverUser()

  if (!user) {
    return (
      <main className="min-h-screen bg-zinc-900 flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="text-white text-lg font-semibold mb-2">Fleet access required</h1>
          <p className="text-zinc-400 text-sm">
            Vehicle handover is limited to warehouse and fleet (admin, manager, fleet tech, warehouse).
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
      asset: {
        select: {
          unitName: true, make: true, model: true, licensePlate: true,
          category: { select: { name: true } },
        },
      },
      bookingItem: {
        select: {
          booking: {
            select: { bookingNumber: true, jobName: true, company: { select: { name: true } } },
          },
        },
      },
      checkoutRecords: {
        orderBy: { checkoutTime: 'desc' },
        take: 1,
        select: {
          id: true, checkoutTime: true, returnTime: true, licenseVerified: true,
          driver: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  })

  if (!assignment) {
    return <Shell><p className="text-zinc-400 text-sm">Booking assignment not found.</p></Shell>
  }

  const booking = assignment.bookingItem.booking
  const checkout = assignment.checkoutRecords[0] ?? null

  const header = (
    <header className="mb-5">
      <div className="text-amber-500 text-xs font-semibold uppercase tracking-wide mb-1">Vehicle handover</div>
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
  )

  // No checkout record means the pre-rental walkaround hasn't been done.
  // Handing over before the inspection would leave existing damage
  // undocumented and billable to this renter, so send them there first.
  if (!checkout) {
    return (
      <Shell>
        {header}
        <div className="bg-zinc-800 border border-amber-700/60 rounded-xl p-5">
          <div className="text-2xl mb-2">📋</div>
          <p className="text-white font-semibold">Inspection first</p>
          <p className="text-zinc-400 text-sm mt-1">
            This unit hasn&rsquo;t had its pre-rental walkaround yet. Do that before handing
            the keys over — otherwise existing damage isn&rsquo;t on record.
          </p>
          <a
            href={`/fleet/inspection/${assignment.id}`}
            className="mt-3 inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
          >
            Start inspection →
          </a>
        </div>
      </Shell>
    )
  }

  if (checkout.returnTime) {
    return (
      <Shell>
        {header}
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-5 text-center">
          <div className="text-3xl mb-2">🏁</div>
          <p className="text-white font-semibold">Already returned</p>
          <p className="text-zinc-400 text-sm mt-1">
            This checkout closed on {checkout.returnTime.toISOString().slice(0, 16).replace('T', ' ')}.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {header}
      <PickupDriverForm
        checkoutId={checkout.id}
        assignedDriver={
          checkout.driver
            ? {
                id: checkout.driver.id,
                name: `${checkout.driver.firstName} ${checkout.driver.lastName}`.trim(),
                licenseVerifiedAtHandover: checkout.licenseVerified,
              }
            : null
        }
      />
    </Shell>
  )
}
