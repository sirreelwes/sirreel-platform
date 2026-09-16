/**
 * Copy one account's standing deal onto another — every negotiated
 * CompanyRate and every ACTIVE CompanyDiscount.
 *
 * Wes, 2026-09-15 (Ruckus) and 2026-09-16 (Smuggler): "same deal as Radical
 * Media". Both were done by hand from a script; the New portal button on
 * /crm/portals now does it through this one function.
 *
 * Never overwrites. A rate the target already negotiated for an item is
 * kept, and a discount is skipped when the target already has one on the
 * same department (or the same label) — copying over it would either
 * re-price a deal someone struck, or discount the same line twice.
 * Rows are copies, not links: renegotiating the source later does not move
 * the target, which is how Radical and Ruckus already behave.
 */

import { prisma } from '@/lib/prisma'

export interface CopyDealResult {
  rateIds: string[]
  discountIds: string[]
  skippedRates: string[]
  skippedDiscounts: string[]
}

export async function copyCompanyDeal(opts: {
  fromCompanyId: string
  toCompanyId: string
  byUserId: string
}): Promise<CopyDealResult> {
  const { fromCompanyId, toCompanyId, byUserId } = opts
  if (fromCompanyId === toCompanyId) throw new Error('Pick a different account to copy from.')

  const [source, target, rates, discounts, haveRates, haveDiscounts] = await Promise.all([
    prisma.company.findUnique({ where: { id: fromCompanyId }, select: { name: true } }),
    prisma.company.findUnique({ where: { id: toCompanyId }, select: { name: true } }),
    prisma.companyRate.findMany({
      where: { companyId: fromCompanyId },
      select: {
        inventoryItemId: true,
        dailyRate: true,
        weeklyRate: true,
        inventoryItem: { select: { code: true, description: true, dailyRate: true, weeklyRate: true } },
      },
    }),
    prisma.companyDiscount.findMany({ where: { companyId: fromCompanyId, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.companyRate.findMany({ where: { companyId: toCompanyId }, select: { inventoryItemId: true } }),
    prisma.companyDiscount.findMany({ where: { companyId: toCompanyId, isActive: true }, select: { departmentKey: true, label: true } }),
  ])
  if (!source || !target) throw new Error('company not found')

  const note = `Same deal as ${source.name}`
  const result: CopyDealResult = { rateIds: [], discountIds: [], skippedRates: [], skippedDiscounts: [] }
  const hasRate = new Set(haveRates.map((r) => r.inventoryItemId))

  for (const r of rates) {
    const itemName = r.inventoryItem.description || r.inventoryItem.code
    if (hasRate.has(r.inventoryItemId)) {
      result.skippedRates.push(itemName)
      continue
    }
    const saved = await prisma.companyRate.create({
      data: {
        companyId: toCompanyId,
        inventoryItemId: r.inventoryItemId,
        dailyRate: r.dailyRate,
        weeklyRate: r.weeklyRate,
        note,
        createdById: byUserId,
      },
      select: { id: true },
    })
    result.rateIds.push(saved.id)
    await prisma.auditLog.create({
      data: {
        userId: byUserId,
        action: 'company.rate.set',
        entityType: 'CompanyRate',
        entityId: saved.id,
        oldValues: {
          listDailyRate: r.inventoryItem.dailyRate.toFixed(2),
          listWeeklyRate: r.inventoryItem.weeklyRate.toFixed(2),
        },
        newValues: {
          companyId: toCompanyId,
          companyName: target.name,
          item: itemName,
          dailyRate: r.dailyRate?.toFixed(2) ?? null,
          weeklyRate: r.weeklyRate?.toFixed(2) ?? null,
          note,
          copiedFromCompanyId: fromCompanyId,
        },
      },
    })
  }

  for (const d of discounts) {
    const clash = haveDiscounts.some(
      (h) =>
        (d.departmentKey && h.departmentKey === d.departmentKey) ||
        h.label.trim().toLowerCase() === d.label.trim().toLowerCase(),
    )
    if (clash) {
      result.skippedDiscounts.push(d.label)
      continue
    }
    const saved = await prisma.companyDiscount.create({
      data: {
        companyId: toCompanyId,
        label: d.label,
        percentOff: d.percentOff,
        departmentKey: d.departmentKey,
        inventoryItemIds: d.inventoryItemIds,
        conditions: d.conditions,
        effectiveDate: d.effectiveDate,
        expiryDate: d.expiryDate,
        sortOrder: d.sortOrder,
        internalNote: note,
        createdById: byUserId,
      },
      select: { id: true },
    })
    result.discountIds.push(saved.id)
    await prisma.auditLog.create({
      data: {
        userId: byUserId,
        action: 'company.discount.create',
        entityType: 'CompanyDiscount',
        entityId: saved.id,
        newValues: {
          companyId: toCompanyId,
          companyName: target.name,
          label: d.label,
          percentOff: d.percentOff,
          departmentKey: d.departmentKey,
          copiedFromCompanyId: fromCompanyId,
        },
      },
    })
  }

  return result
}
