/**
 * GET /api/scheduling/hub-summary
 *
 * One small summary endpoint for the /scheduling control hub.
 * Returns the at-a-glance counters the operator wants to see when
 * they land on the page — without each tile having to do its own
 * round trip.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const STALE_DAYS = 14

export async function GET() {
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 86_400_000)

  const [
    planyoImported,
    cartIdStamped,
    primaryHolds,
    backupHolds,
    staleHolds,
    bookingItemsAssigned,
    bookingAssignments,
    categoriesPublished,
    serviceableAssets,
    totalAssets,
  ] = await Promise.all([
    prisma.booking.count({ where: { source: 'PLANYO_BACKFILL' } }),
    prisma.booking.count({ where: { planyoCartId: { not: null } } }),
    prisma.bookingItem.count({ where: { status: 'REQUESTED', holdRank: 1 } }),
    prisma.bookingItem.count({ where: { status: { in: ['REQUESTED', 'ASSIGNED'] }, holdRank: { gt: 1 } } }),
    prisma.bookingItem.count({
      where: {
        status: 'REQUESTED',
        holdRank: 1,
        booking: { archivedAt: null, createdAt: { lt: staleCutoff } },
      },
    }),
    prisma.bookingItem.count({ where: { status: 'ASSIGNED' } }),
    prisma.bookingAssignment.count({ where: { status: { in: ['ASSIGNED', 'CHECKED_OUT'] } } }),
    prisma.assetCategory.count({ where: { isPublished: true } }),
    prisma.asset.count({
      where: {
        isActive: true,
        status: { notIn: ['MAINTENANCE', 'RETIRED', 'SOLD', 'STOLEN', 'TOTALED'] },
      },
    }),
    prisma.asset.count({ where: { isActive: true } }),
  ])

  return NextResponse.json({
    ok: true,
    staleDays: STALE_DAYS,
    counts: {
      planyoImported,
      cartIdStamped,
      primaryHolds,
      backupHolds,
      staleHolds,
      bookingItemsAssigned,
      bookingAssignments,
      categoriesPublished,
      serviceableAssets,
      totalAssets,
    },
  })
}
