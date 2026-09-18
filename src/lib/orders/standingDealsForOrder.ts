/**
 * The DB half of the order page's standing-deal reminder — read the
 * client's live deals and reconcile them against this order.
 *
 * Split from standingDealCheck.ts the way partnerMargins is split from
 * discountWaterfall: the RULE is pure and tested, the QUERY lives here.
 *
 * The in-window filter is the same one applyStandingDiscounts and
 * findItemStandingDiscount use. It has to be — a reminder that counts a
 * lapsed deal as owed sends a rep to discount something nobody agreed
 * to any more.
 */

import { prisma } from '@/lib/prisma'
import { reconcileStandingDeals, type StandingDealReport } from './standingDealCheck'

export async function standingDealsForOrder(orderId: string): Promise<StandingDealReport[]> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { companyId: true },
  })
  if (!order?.companyId) return []

  const now = new Date()
  const deals = await prisma.companyDiscount.findMany({
    where: {
      companyId: order.companyId,
      isActive: true,
      AND: [
        { OR: [{ effectiveDate: null }, { effectiveDate: { lte: now } }] },
        { OR: [{ expiryDate: null }, { expiryDate: { gte: now } }] },
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, label: true, percentOff: true,
      departmentKey: true, inventoryItemIds: true,
    },
  })
  if (deals.length === 0) return []

  const [discounts, lines] = await Promise.all([
    prisma.orderDiscount.findMany({
      where: { orderId },
      select: { scope: true, departmentKey: true, type: true, value: true, label: true },
    }),
    prisma.orderLineItem.findMany({
      where: { orderId },
      select: {
        id: true, description: true, inventoryItemId: true,
        department: true, rate: true, resolvedRate: true,
      },
    }),
  ])

  return reconcileStandingDeals({
    deals,
    discounts: discounts.map((d) => ({
      scope: d.scope,
      departmentKey: d.departmentKey,
      type: d.type,
      value: Number(d.value),
      label: d.label,
    })),
    lines: lines.map((l) => ({
      id: l.id,
      description: l.description,
      inventoryItemId: l.inventoryItemId,
      department: l.department,
      rate: Number(l.rate),
      resolvedRate: l.resolvedRate == null ? null : Number(l.resolvedRate),
    })),
  })
}
