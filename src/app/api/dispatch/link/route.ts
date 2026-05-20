import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface LinkBody {
  // Either link a single reservation by id …
  reservationId?: string
  // … or link an entire Planyo cart in one go (the common case —
  // multi-unit jobs cluster on planyoCartId).
  planyoCartId?: string
  bookingId: string
}

interface BulkLinkItem {
  reservationId?: string
  planyoCartId?: string
  bookingId: string
}

/**
 * POST /api/dispatch/link
 *
 * Stamp `bookingId` on either a single Reservation row or every
 * Reservation sharing a `planyoCartId`. Returns the count affected.
 * Idempotent — re-linking to the same bookingId is a no-op.
 *
 * Body (single):
 *   { reservationId: "...", bookingId: "..." }
 *   { planyoCartId: "...",  bookingId: "..." }
 *
 * Body (bulk):
 *   { items: [{ planyoCartId, bookingId }, ...] }
 *
 * The bulk form is what the "Auto-link all HIGH confidence" button
 * uses — one transaction per item so a single bad bookingId doesn't
 * abort the whole sweep.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as LinkBody & { items?: BulkLinkItem[] }

  if (Array.isArray(body.items)) {
    const results: Array<{ ok: boolean; count: number; key: string; error?: string }> = []
    for (const item of body.items) {
      try {
        const count = await applyLink(item.reservationId, item.planyoCartId, item.bookingId)
        results.push({ ok: true, count, key: item.planyoCartId || item.reservationId || '?' })
      } catch (err) {
        results.push({
          ok: false,
          count: 0,
          key: item.planyoCartId || item.reservationId || '?',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    const totalLinked = results.reduce((s, r) => s + r.count, 0)
    return NextResponse.json({ ok: true, totalLinked, results })
  }

  try {
    const count = await applyLink(body.reservationId, body.planyoCartId, body.bookingId)
    return NextResponse.json({ ok: true, count })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

async function applyLink(
  reservationId: string | undefined,
  planyoCartId: string | undefined,
  bookingId: string,
): Promise<number> {
  if (!bookingId) throw new Error('bookingId is required')
  if (!reservationId && !planyoCartId) {
    throw new Error('either reservationId or planyoCartId is required')
  }

  // Validate that the target booking actually exists before
  // stamping — otherwise a stale UI could write a FK to nowhere.
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true },
  })
  if (!booking) throw new Error(`Booking ${bookingId} not found`)

  if (planyoCartId) {
    const result = await prisma.reservation.updateMany({
      where: { planyoCartId },
      data: { bookingId },
    })
    return result.count
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { bookingId },
  })
  return 1
}
