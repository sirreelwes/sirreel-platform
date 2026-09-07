/**
 * /fleet/pickup/[bookingAssignmentId] — Sprint 2B physical handover.
 *
 * The sibling of /fleet/inspection/[bookingAssignmentId]: the walkaround
 * happens before anyone knows who the production is sending, this is the
 * moment that person turns up and the keys move. Same shape on purpose —
 * SERVER component with the role gate here (not in the UI), mobile-first
 * single column, outside the (dashboard) group so there's no desktop
 * chrome on a phone at the gate, and absent from the tsx/orders
 * middleware allow-lists so it only resolves on the hq host. Chrome from
 * the shared yard kit.
 *
 * This screen is where the licence gate is actually enforced in front of
 * a person. Its job is not merely to say no: every blocker it can raise
 * has a fix available right here, because a rep holding up a truck at 6am
 * needs a path forward, not a locked door.
 */

import { ClipboardList, Flag, ArrowRight, SearchX } from 'lucide-react'
import { getVehicleHandoverUser } from '@/lib/fleet/requireVehicleHandoverAccess'
import { prisma } from '@/lib/prisma'
import { PickupDriverForm } from '@/components/fleet/PickupDriverForm'
import { YardHeader, YardNotice, YardOutcome, YardShell, fmtYardWhen, yardBtnPrimary } from '@/components/fleet/yard-ui'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ bookingAssignmentId: string }> }

export default async function FleetPickupPage({ params }: Params) {
  const { bookingAssignmentId } = await params
  const user = await getVehicleHandoverUser()

  if (!user) {
    return (
      <YardNotice title="Fleet access required">
        Vehicle handover is limited to warehouse and fleet (admin, manager, fleet tech, warehouse). Sign in at{' '}
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
    return (
      <YardNotice icon={SearchX} title="Booking assignment not found">
        The link may be stale. Open the unit from <a className="text-amber-400 underline" href="/yard">today&rsquo;s board</a>.
      </YardNotice>
    )
  }

  const booking = assignment.bookingItem.booking
  const checkout = assignment.checkoutRecords[0] ?? null

  const header = (
    <YardHeader
      step="pickup"
      eyebrow="Vehicle handover"
      vehicle={assignment.asset}
      booking={{ jobName: booking.jobName, company: booking.company?.name, bookingNumber: booking.bookingNumber }}
      dateLabel="Out"
      date={assignment.startDate}
    />
  )

  // No checkout record means the pre-rental walkaround hasn't been done.
  // Handing over before the inspection would leave existing damage
  // undocumented and billable to this renter, so send them there first.
  if (!checkout) {
    return (
      <YardShell padBottom={false}>
        {header}
        <YardOutcome
          icon={ClipboardList}
          tone="warn"
          title="Inspection first"
          actions={
            <a href={`/fleet/inspection/${assignment.id}`} className={yardBtnPrimary}>
              Start inspection
              <ArrowRight size={16} aria-hidden />
            </a>
          }
        >
          <p>
            This unit hasn&rsquo;t had its pre-rental walk-around yet. Do that before handing the keys over —
            otherwise existing damage isn&rsquo;t on record.
          </p>
        </YardOutcome>
      </YardShell>
    )
  }

  if (checkout.returnTime) {
    return (
      <YardShell padBottom={false}>
        {header}
        <YardOutcome icon={Flag} title="Already returned">
          <p>This checkout closed on {fmtYardWhen(checkout.returnTime)}.</p>
        </YardOutcome>
      </YardShell>
    )
  }

  return (
    <YardShell>
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
    </YardShell>
  )
}
