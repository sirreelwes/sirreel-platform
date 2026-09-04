/**
 * "When these kinds of discounts exist at the company level, agents will
 * need approval to add further discounts." — Wes 2026-09-04.
 *
 * A standing deal (a CompanyDiscount, or a negotiated CompanyRate) is a
 * price the account already negotiated with SirReel. An agent stacking an
 * order-level discount on top of it is giving the same concession twice,
 * or a third time — and the client's own portal now prints the deal, so
 * the quote and the portal would disagree about what the client gets.
 *
 * So on an account with standing deals, ADDING an order discount, or
 * RAISING one, is an ADMIN action. Lowering or removing one is not gated:
 * nobody needs sign-off to give less away.
 *
 * ADMIN is Wes and Dani. The gate is a role check on purpose — this is
 * "a manager signs off", not the Wes-only export approval.
 */

import { prisma } from '@/lib/prisma'

export interface StandingDealGateResult {
  /** True when the caller may proceed. */
  ok: boolean
  /** Why not — client-facing copy for the 403. */
  reason?: string
  /** What the account has, for the message and the audit line. */
  deals?: string[]
}

export async function gateFurtherDiscount(
  orderId: string,
  userId: string,
): Promise<StandingDealGateResult> {
  const [order, user] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId }, select: { companyId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ])
  if (!order) return { ok: true }
  if (user?.role === 'ADMIN') return { ok: true }

  const now = new Date()
  const [discounts, rates] = await Promise.all([
    prisma.companyDiscount.findMany({
      where: {
        companyId: order.companyId,
        isActive: true,
        AND: [
          { OR: [{ effectiveDate: null }, { effectiveDate: { lte: now } }] },
          { OR: [{ expiryDate: null }, { expiryDate: { gte: now } }] },
        ],
      },
      select: { label: true, percentOff: true },
    }),
    prisma.companyRate.findMany({
      where: { companyId: order.companyId, OR: [{ dailyRate: { gt: 0 } }, { weeklyRate: { gt: 0 } }] },
      select: { inventoryItem: { select: { description: true, code: true } }, dailyRate: true },
    }),
  ])
  if (discounts.length === 0 && rates.length === 0) return { ok: true }

  const deals = [
    ...discounts.map((d) => `${d.percentOff}% off ${d.label}`),
    ...rates.map((r) => `$${Number(r.dailyRate ?? 0)}/day ${r.inventoryItem.description || r.inventoryItem.code}`),
  ]
  return {
    ok: false,
    deals,
    reason:
      `This account already has standing deals (${deals.slice(0, 3).join('; ')}${deals.length > 3 ? '; …' : ''}). ` +
      'Adding a further discount needs an admin — ask Wes or Dani to apply it.',
  }
}
