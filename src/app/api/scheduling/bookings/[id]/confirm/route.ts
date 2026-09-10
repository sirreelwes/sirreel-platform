/**
 * POST /api/scheduling/bookings/[id]/confirm
 *
 * Lightweight Booking.status transition — flips REQUEST or
 * PENDING_APPROVAL to CONFIRMED. Powers the Book action on the
 * Timeline (Part 4 of the gantt-renders-backups task).
 *
 * Explicitly NOT a triggers-anything route: no portal/sign
 * cadence, no email, no touching backups or assignments. Just the
 * status flip. Idempotent for CONFIRMED.
 *
 * Confirmable states: REQUEST, AI_REVIEW, PENDING_APPROVAL.
 * Terminal states (CANCELLED / ARCHIVED / RETURNED) and the
 * post-confirmation state ACTIVE all return 409 — they need
 * different action paths than a casual "book it" click.
 *
 * The rule itself now lives in lib/bookings/confirmBooking.ts, because
 * bookOrder confirms the reservation too and the two must not drift on
 * what confirming means. This route keeps the auth, the HTTP shapes and
 * the status codes; the helper owns the transition.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { CONFIRMABLE_FROM, confirmBooking } from '@/lib/bookings/confirmBooking'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  // SALES action (2026-07 re-split): confirming a booking is reservation
  // control (canCreateBooking) — consistent with the status route, which
  // already lets sales set Booked/CONFIRMED. Was fleet (requireDispatchAccess).
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  })
  if (!actor || !can(actor.role, 'canCreateBooking')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'confirming a booking is a sales action' },
      { status: 403 },
    )
  }
  const result = await confirmBooking(prisma, params.id)

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'booking not found' }, { status: 404 })
    }
    if (result.reason === 'archived') {
      return NextResponse.json(
        { error: 'cannot confirm', reason: 'Booking is archived; restore it before confirming.' },
        { status: 409 },
      )
    }
    return NextResponse.json(
      {
        error: 'cannot confirm',
        reason: `Booking is in status=${result.booking.status}; confirmable only from ${CONFIRMABLE_FROM.join(', ')}.`,
        bookingId: result.booking.id,
        currentStatus: result.booking.status,
      },
      { status: 409 },
    )
  }

  if (!result.changed) {
    return NextResponse.json({
      ok: true,
      alreadyConfirmed: true,
      bookingId: result.booking.id,
      bookingNumber: result.booking.bookingNumber,
    })
  }

  return NextResponse.json({
    ok: true,
    booking: result.booking,
    previousStatus: result.previousStatus,
  })
}
