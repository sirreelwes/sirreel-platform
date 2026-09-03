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
import { Lock, CheckCircle2, ArrowLeft, ArrowRight, FileText } from 'lucide-react'
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
          <Lock size={32} aria-hidden className="mx-auto mb-3 text-zinc-500" />
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
      <Link href="/yard" className="text-zinc-500 text-xs hover:text-zinc-300 inline-flex items-center gap-1">
        <ArrowLeft size={12} aria-hidden />
        Back to today
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
          <CheckCircle2 size={30} aria-hidden className="mx-auto mb-2 text-emerald-500" />
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
          <div className="mt-4 flex flex-col items-center gap-2">
            <Link
              href="/yard"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
            >
              Back to today
              <ArrowRight size={14} aria-hidden />
            </Link>
            {/* The out-vs-back document. Viewing is open to yard staff;
                sending it to the renter is still gated off — see
                inspectionReportSendingEnabled. */}
            <a
              href={`/api/fleet/inspections/report/${assignment.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-zinc-400 text-xs hover:text-amber-500"
            >
              <FileText size={12} aria-hidden />
              Condition report (out vs back)
            </a>
          </div>
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
        photos: checkoutRow.photos,
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
