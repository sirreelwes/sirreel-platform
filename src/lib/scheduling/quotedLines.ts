/**
 * The order lines behind a hold — the only thing that knows which DAYS a
 * class was actually quoted for. Fed to `resolveAssignWindow`
 * (assignWindow.ts), which is kept pure so the rule can be tested
 * without a database.
 */
import { prisma } from '@/lib/prisma'

/**
 * DB-backed: the lines on `orderId` (or on every live order of the job,
 * when no order is named) that were quoted against this class.
 *
 * Matched the way holdOnQuoteSend created the hold — directly by legacy
 * `assetCategoryId`, or through the catalog row's
 * `legacyAssetCategoryId`.
 */
export async function quotedLinesForHold(args: {
  categoryId: string
  jobId?: string | null
  orderId?: string | null
}): Promise<{ pickupDate: Date; returnDate: Date; quantity: number }[]> {
  if (!args.orderId && !args.jobId) return []
  const lines = await prisma.orderLineItem.findMany({
    where: {
      ...(args.orderId
        ? { orderId: args.orderId }
        : { order: { jobId: args.jobId ?? undefined, status: { notIn: ['CANCELLED'] }, archivedAt: null } }),
      OR: [
        { assetCategoryId: args.categoryId },
        { inventoryItem: { legacyAssetCategoryId: args.categoryId } },
      ],
    },
    select: { pickupDate: true, returnDate: true, quantity: true },
    orderBy: { pickupDate: 'asc' },
  })
  return lines.map((l) => ({ pickupDate: l.pickupDate, returnDate: l.returnDate, quantity: l.quantity }))
}
