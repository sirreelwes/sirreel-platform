/**
 * /fleet/return/[bookingAssignmentId] — the return-side inspection.
 *
 * The third screen in the vehicle's arc and the one that was missing:
 * /fleet/inspection is the pre-rental walkaround, /fleet/pickup is the
 * handover when the client's driver turns up, and until now there was
 * nothing for the moment it comes back. The yard board could only say
 * "Due back" and leave it there, which is why a returning truck was
 * neither work to do nor work anyone could finish.
 *
 * Same shape as its two siblings on purpose: SERVER component with the
 * role gate here rather than in the UI, mobile-first single column, and
 * outside the (dashboard) group so there is no desktop chrome on a
 * phone at the gate. Chrome from the shared yard kit.
 *
 * It loads the CHECKOUT inspection and hands it to the form. That is
 * not decoration — a return check is a comparison, and a tech who
 * cannot see what was already wrong with the truck will log it again as
 * new damage against a client who did not cause it.
 */

import { CheckCircle2, ArrowRight, FileText, SearchX } from 'lucide-react'
import { getFleetInspectionUser } from '@/lib/fleet/requireFleetInspectionAccess'
import { prisma } from '@/lib/prisma'
import { InspectionReturnForm, type CheckoutSnapshot } from '@/components/fleet/InspectionReturnForm'
import {
  YardHeader,
  YardNotice,
  YardOutcome,
  YardShell,
  fmtYardWhen,
  yardBtnLink,
  yardBtnPrimary,
} from '@/components/fleet/yard-ui'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ bookingAssignmentId: string }> }

export default async function FleetReturnPage({ params }: Params) {
  const { bookingAssignmentId } = await params
  const user = await getFleetInspectionUser()

  if (!user) {
    return (
      <YardNotice title="Fleet access required">
        Return check-ins are limited to yard ops (admin, manager, fleet tech, warehouse). Sign in at{' '}
        <a className="text-amber-400 underline" href="/login">hq.sirreel.com/login</a> with a yard account.
      </YardNotice>
    )
  }

  const assignment = await prisma.bookingAssignment.findUnique({
    where: { id: bookingAssignmentId },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
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
            select: { bookingNumber: true, jobName: true, company: { select: { name: true } } },
          },
        },
      },
      inspections: {
        where: { type: { in: ['CHECKOUT', 'RETURN'] } },
        select: {
          id: true,
          type: true,
          inspectionDate: true,
          overallCondition: true,
          fuelLevel: true,
          mileageAtInspection: true,
          notes: true,
          inspectedByUser: { select: { name: true } },
          inspectedByDriver: { select: { firstName: true, lastName: true } },
          // The check-out walk-around, laid beside the new shots
          // slot-by-slot. Ordered so the guided slots come before
          // anything free-form or pre-guided-capture (position null).
          photos: {
            select: { id: true, position: true },
            orderBy: { createdAt: 'asc' },
          },
          damageItems: {
            where: { isPreExisting: true },
            select: {
              id: true,
              locationOnVehicle: true,
              damageType: true,
              severity: true,
              notes: true,
            },
          },
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
  const checkoutRow = assignment.inspections.find((i) => i.type === 'CHECKOUT') ?? null
  const returnRow = assignment.inspections.find((i) => i.type === 'RETURN') ?? null
  const reportHref = `/api/fleet/inspections/report/${assignment.id}`

  const header = (
    <YardHeader
      step="return"
      eyebrow="Return check-in"
      vehicle={assignment.asset}
      booking={{ jobName: booking.jobName, company: booking.company?.name, bookingNumber: booking.bookingNumber }}
      dateLabel="Due back"
      date={assignment.endDate}
    />
  )

  if (returnRow) {
    return (
      <YardShell padBottom={false}>
        {header}
        <YardOutcome
          icon={CheckCircle2}
          title="Already checked in"
          actions={
            <>
              <a href="/yard" className={yardBtnPrimary}>
                Back to today
                <ArrowRight size={16} aria-hidden />
              </a>
              {/* The out-vs-back document. Viewing is open to yard staff;
                  sending it to the renter is still gated off — see
                  inspectionReportSendingEnabled. */}
              <a href={reportHref} target="_blank" rel="noreferrer" className={yardBtnLink}>
                <FileText size={14} aria-hidden />
                Condition report (out vs back)
              </a>
            </>
          }
        >
          <p>
            {fmtYardWhen(returnRow.inspectionDate)} by {returnRow.inspectedByUser?.name || 'fleet'}
          </p>
          <p className="text-zinc-400 text-[13px]">
            {[
              returnRow.fuelLevel ? `Fuel ${returnRow.fuelLevel}` : null,
              returnRow.mileageAtInspection != null ? `${returnRow.mileageAtInspection.toLocaleString()} mi` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Fuel and odometer not recorded'}
          </p>
        </YardOutcome>
      </YardShell>
    )
  }

  const checkout: CheckoutSnapshot | null = checkoutRow
    ? {
        inspectionDate: checkoutRow.inspectionDate.toISOString(),
        // A blind pickup's check-out was done by the DRIVER, not a tech.
        inspectorName:
          checkoutRow.inspectedByUser?.name ??
          (checkoutRow.inspectedByDriver
            ? `${checkoutRow.inspectedByDriver.firstName} ${checkoutRow.inspectedByDriver.lastName}`.trim() + ' (driver)'
            : null),
        overallCondition: checkoutRow.overallCondition,
        fuelLevel: checkoutRow.fuelLevel,
        mileage: checkoutRow.mileageAtInspection,
        notes: checkoutRow.notes,
        photos: checkoutRow.photos,
        preExisting: checkoutRow.damageItems,
      }
    : null

  return (
    <YardShell>
      {header}
      <InspectionReturnForm bookingAssignmentId={assignment.id} checkout={checkout} reportHref={reportHref} />
    </YardShell>
  )
}
