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
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

const CONFIRMABLE_FROM: readonly BookingStatus[] = ['REQUEST', 'AI_REVIEW', 'PENDING_APPROVAL'] as const

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    select: { id: true, bookingNumber: true, status: true, archivedAt: true },
  })
  if (!booking) return NextResponse.json({ error: 'booking not found' }, { status: 404 })

  if (booking.archivedAt) {
    return NextResponse.json(
      { error: 'cannot confirm', reason: 'Booking is archived; restore it before confirming.' },
      { status: 409 },
    )
  }

  if (booking.status === 'CONFIRMED') {
    return NextResponse.json({ ok: true, alreadyConfirmed: true, bookingId: booking.id, bookingNumber: booking.bookingNumber })
  }

  if (!CONFIRMABLE_FROM.includes(booking.status)) {
    return NextResponse.json(
      {
        error: 'cannot confirm',
        reason: `Booking is in status=${booking.status}; confirmable only from ${CONFIRMABLE_FROM.join(', ')}.`,
        bookingId: booking.id,
        currentStatus: booking.status,
      },
      { status: 409 },
    )
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
    select: { id: true, bookingNumber: true, status: true, confirmedAt: true },
  })

  return NextResponse.json({
    ok: true,
    booking: updated,
    previousStatus: booking.status,
  })
}
