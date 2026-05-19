import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/bookings/[id]
 *
 * Comprehensive native booking detail for the JobDashboard drawer.
 * Returns everything the drawer's tabs need in one round trip:
 *   - company, person, agent, referredBy
 *   - BookingItem[] + per-item BookingAssignment[] + Asset
 *   - PaperworkRequest[] (most recent first)
 *   - DispatchTask[] / InsuranceClaim[]
 *   - Booking.orders[] (when an Order has been spawned from this
 *     Booking) — includes SignedAgreement[] + PortalAccess[] + line
 *     items so the Paperwork tab can render the rental-agreement /
 *     stage-contract / COI signing status.
 *
 * Read-only. Auth-gated by NextAuth session (any signed-in user can
 * read; row-level filtering happens upstream if needed).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    include: {
      company: true,
      person: true,
      referredBy: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      agent: { select: { id: true, name: true, email: true, phone: true, displayTitle: true } },
      items: {
        include: {
          category: { select: { id: true, name: true } },
          assignments: {
            include: {
              asset: {
                select: { id: true, unitName: true, year: true, make: true, model: true, licensePlate: true, vin: true },
              },
            },
          },
        },
      },
      paperworkRequests: { orderBy: { sentAt: 'desc' } },
      dispatchTasks: { orderBy: { createdAt: 'desc' } },
      insuranceClaims: { orderBy: { createdAt: 'desc' } },
      orders: {
        include: {
          lineItems: {
            select: {
              id: true, type: true, description: true, quantity: true, rate: true, lineTotal: true, billableDays: true,
              assetCategory: { select: { name: true } },
            },
            orderBy: { sortOrder: 'asc' },
          },
          signedAgreements: {
            select: { id: true, contractType: true, status: true, signedAt: true, signerName: true, documentToSignUrl: true, signedDocumentUrl: true },
          },
          portalAccesses: {
            select: {
              id: true, magicLinkExpiresAt: true, lastAccessedAt: true, accessCount: true, revokedAt: true,
              contact: { select: { firstName: true, lastName: true, email: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  })

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  return NextResponse.json({ booking })
}
