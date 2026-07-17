import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

/**
 * PENDING shoot-days claims that block commitment (Wes ruling B).
 * Only gear/vehicle lines gate — stage lines never carry claims and
 * never block (enforced at claim-intake too; the filter here is
 * belt-and-suspenders).
 */
export async function findPendingDayClaims(
  orderId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return db.orderLineItem.findMany({
    where: {
      orderId,
      claimStatus: 'PENDING',
      type: { in: ['VEHICLE', 'EQUIPMENT'] },
      department: { not: 'STAGES' },
    },
    select: {
      id: true,
      description: true,
      computedDays: true,
      claimedDays: true,
      pickupDate: true,
      returnDate: true,
    },
  })
}
