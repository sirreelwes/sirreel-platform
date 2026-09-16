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

import { Lock, ClipboardList, Flag } from 'lucide-react'
import { getVehicleHandoverUser } from '@/lib/fleet/requireVehicleHandoverAccess'
import { prisma } from '@/lib/prisma'
import { PickupDriverForm } from '@/components/fleet/PickupDriverForm'
import { VehicleBlindToggle } from '@/components/fleet/VehicleBlindToggle'

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
          <Lock size={32} aria-hidden className="mx-auto mb-3 text-zinc-500" />
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
            select: {
              bookingNumber: true, jobName: true, jobId: true, company: { select: { name: true } },
              // Blind handoff lives on the order, and the rep standing at
              // the gate is often the first to know it just became one
              // (Wes 2026-09-15: "always allow the fleet guy to change to
              // a blind pickup").
              job: {
                select: {
                  orders: {
                    where: { status: { not: 'CANCELLED' } },
                    select: { id: true, orderNumber: true, status: true, blindPickup: true, blindReturn: true },
                    orderBy: { createdAt: 'asc' },
                  },
                },
              },
            },
          },
        },
      },
      checkoutRecords: {
        orderBy: { checkoutTime: 'desc' },
        take: 1,
        select: {
          id: true, checkoutTime: true, returnTime: true, licenseVerified: true, checkoutInspectionId: true,
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
        {booking.jobName} — {booking.company?.name ?? '—'} ({booking.bookingNumber})
      </p>
      <p className="text-zinc-500 text-xs mt-0.5">
        {[assignment.asset.make, assignment.asset.model].filter(Boolean).join(' ')}
        {assignment.asset.licensePlate ? ` · ${assignment.asset.licensePlate}` : ''}
        {' · out '}{assignment.startDate.toISOString().slice(0, 10)}
      </p>
      {/* Nobody meeting the driver? Say so here — it opens the driver's
          own check-out and the codes on their /drive page. */}
      <VehicleBlindToggle
        orders={booking.job?.orders ?? []}
        kinds={['blindPickup', 'blindReturn']}
        tone="dark"
        className="mt-3"
      />
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
          <ClipboardList size={26} aria-hidden className="mx-auto mb-2 text-zinc-400" />
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
          <Flag size={30} aria-hidden className="mx-auto mb-2 text-emerald-500" />
          <p className="text-white font-semibold">Already returned</p>
          <p className="text-zinc-400 text-sm mt-1">
            This checkout closed on {checkout.returnTime.toISOString().slice(0, 16).replace('T', ' ')}.
          </p>
        </div>
      </Shell>
    )
  }

  // The drivers the client or office already NAMED — for this unit first,
  // then anywhere else on the job. The picker used to open on the first
  // eight names of the whole driver file, A–Z: on Cube 28 (2026-09-15)
  // Julian saw Dominic, Dylan, Emily… while the job's actual driver,
  // Wendell Peters, wasn't on screen at all.
  const jobId = booking.jobId
  const named = await prisma.driverAssignment.findMany({
    where: {
      status: { not: 'CANCELLED' },
      OR: [
        { bookingAssignmentId: assignment.id },
        ...(jobId ? [{ bookingAssignment: { bookingItem: { booking: { jobId } } } }] : []),
      ],
    },
    orderBy: { invitedAt: 'asc' },
    select: { driverId: true, bookingAssignmentId: true },
  })
  const namedDrivers: { id: string; forThisUnit: boolean }[] = []
  for (const n of [...named].sort((a, b) => Number(b.bookingAssignmentId === assignment.id) - Number(a.bookingAssignmentId === assignment.id))) {
    if (!namedDrivers.some((d) => d.id === n.driverId)) {
      namedDrivers.push({ id: n.driverId, forThisUnit: n.bookingAssignmentId === assignment.id })
    }
  }

  return (
    <Shell>
      {header}
      {/* The licence is asked for per DRIVER inside the form — only when
          none is on file, and the fleet tech takes it (Wes 2026-09-16). */}
      <PickupDriverForm
        checkoutId={checkout.id}
        inspectionId={checkout.checkoutInspectionId}
        namedDrivers={namedDrivers}
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
