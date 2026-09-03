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
 * phone at the gate.
 *
 * It loads the CHECKOUT inspection and hands it to the form. That is
 * not decoration — a return check is a comparison, and a tech who
 * cannot see what was already wrong with the truck will log it again as
 * new damage against a client who did not cause it.
 */

import Link from 'next/link'
import { getFleetInspectionUser } from '@/lib/fleet/requireFleetInspectionAccess'
import { prisma } from '@/lib/prisma'
import { InspectionReturnForm, type CheckoutSnapshot } from '@/components/fleet/InspectionReturnForm'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ bookingAssignmentId: string }> }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-900 px-4 py-6">
      <div className="max-w-md mx-auto">{children}</div>
    </main>
  )
}

export default async function FleetReturnPage({ params }: Params) {
  const { bookingAssignmentId } = await params
  const user = await getFleetInspectionUser()

  if (!user) {
    return (
      <main className="min-h-screen bg-zinc-900 flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="text-white text-lg font-semibold mb-2">Fleet access required</h1>
          <p className="text-zinc-400 text-sm">
            Return check-ins are limited to yard ops (admin, manager, fleet tech, warehouse). Sign in at{' '}
            <a className="text-amber-500 underline" href="/login">hq.sirreel.com/login</a> with a yard account.
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
      <Shell>
        <p className="text-zinc-400 text-sm">Booking assignment not found.</p>
      </Shell>
    )
  }

  const booking = assignment.bookingItem.booking
  const checkoutRow = assignment.inspections.find((i) => i.type === 'CHECKOUT') ?? null
  const returnRow = assignment.inspections.find((i) => i.type === 'RETURN') ?? null

  const header = (
    <header className="mb-5">
      <Link href="/yard" className="text-zinc-500 text-xs hover:text-zinc-300">
        ← Back to today
      </Link>
      <div className="text-amber-500 text-xs font-semibold uppercase tracking-wide mb-1 mt-3">
        Return check-in
      </div>
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
        {' · due back '}
        {assignment.endDate.toISOString().slice(0, 10)}
      </p>
    </header>
  )

  if (returnRow) {
    return (
      <Shell>
        {header}
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-5 text-center">
          <div className="text-3xl mb-2">✅</div>
          <p className="text-white font-semibold">Already checked in</p>
          <p className="text-zinc-400 text-sm mt-1">
            {returnRow.inspectionDate.toISOString().slice(0, 16).replace('T', ' ')} by{' '}
            {returnRow.inspectedByUser.name || 'fleet'}
          </p>
          <p className="text-zinc-500 text-xs mt-2">
            Condition {returnRow.overallCondition.toLowerCase()}
            {returnRow.fuelLevel ? ` · fuel ${returnRow.fuelLevel}` : ''}
            {returnRow.mileageAtInspection != null
              ? ` · ${returnRow.mileageAtInspection.toLocaleString()} mi`
              : ''}
          </p>
          <Link
            href="/yard"
            className="mt-4 inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
          >
            Back to today →
          </Link>
        </div>
      </Shell>
    )
  }

  const checkout: CheckoutSnapshot | null = checkoutRow
    ? {
        inspectionDate: checkoutRow.inspectionDate.toISOString(),
        inspectorName: checkoutRow.inspectedByUser.name,
        overallCondition: checkoutRow.overallCondition,
        fuelLevel: checkoutRow.fuelLevel,
        mileage: checkoutRow.mileageAtInspection,
        notes: checkoutRow.notes,
        preExisting: checkoutRow.damageItems,
      }
    : null

  return (
    <Shell>
      {header}
      <InspectionReturnForm bookingAssignmentId={assignment.id} checkout={checkout} />
    </Shell>
  )
}
