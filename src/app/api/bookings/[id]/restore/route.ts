import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bookings/[id]/restore
 *
 * Undo a prior archive — clears `archivedAt`. Sibling to /archive.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const updated = await prisma.booking.update({
    where: { id: params.id },
    data: { archivedAt: null },
    select: { id: true, archivedAt: true },
  })

  return NextResponse.json({ ok: true, booking: updated })
}
