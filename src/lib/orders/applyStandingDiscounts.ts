/**
 * Put the client's standing discounts on an order.
 *
 * Wes 2026-09-04: "These discounts should be auto applied in all orders
 * from that company going forward."
 *
 * ── Why seed rows instead of computing at render time ──────────────────
 * The alternative — teach computeOrderTotals to look up the company's
 * discounts every time it runs — is worse in the way that matters most for
 * money: a quote sent in March would silently re-price itself in June when
 * someone edits the deal. Signed quotes and issued invoices would disagree
 * with the PDFs already in the client's inbox.
 *
 * Seeding a real OrderDiscount at CREATE makes the discount a fact of that
 * order. It prints, it audits, a rep can see it and adjust it for a
 * one-off exception, and changing the standing deal later moves the next
 * order and not the last one — which is exactly what "going forward"
 * means.
 *
 * ── Only DEPARTMENT-scoped rows land here ──────────────────────────────
 * Item-scoped standing discounts ("20% off cube trucks and cargo vans")
 * apply at the RATE instead, inside resolveRate — a department discount
 * covering a slice of a department would discount the rest of it too.
 * Honouring the same row in both places would discount a line twice, so
 * the split is enforced by the query here (`departmentKey: { not: null }`)
 * and by the mirrored one in findItemStandingDiscount.
 *
 * Idempotent: an order that already carries a discount row for a
 * department is left alone. Re-running this (a retry, a re-import) never
 * stacks a second 50% on the same section.
 *
 * That idempotence is also why this is not only a create-time call. The
 * job company-change route runs it on every order it just moved, so the
 * new account's terms follow the job — and relies on the skip to leave a
 * rep's own department discount where it is. What the skip hides, that
 * route reports as a conflict rather than resolving.
 */

import type { LineItemDepartment, Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { isDiscountableDepartment } from './discountedTotals'

type Db = PrismaClient | Prisma.TransactionClient

export interface SeededDiscount {
  departmentKey: string
  percentOff: number
  label: string
}

/**
 * The account's live DEPARTMENT-scoped deals, best first.
 *
 * Exported because the job company-change route needs the same list to
 * report what it could NOT seed, and a second copy of the in-window
 * filter is how a reminder starts disagreeing with what actually
 * applied.
 */
export async function activeStandingDepartmentDiscounts(
  companyId: string,
  db: Db = defaultPrisma,
): Promise<{ label: string; percentOff: number; departmentKey: LineItemDepartment | null }[]> {
  const now = new Date()
  return db.companyDiscount.findMany({
    where: {
      companyId,
      isActive: true,
      departmentKey: { not: null },
      AND: [
        { OR: [{ effectiveDate: null }, { effectiveDate: { lte: now } }] },
        { OR: [{ expiryDate: null }, { expiryDate: { gte: now } }] },
      ],
    },
    // Best deal first, so if the same department somehow carries two rows
    // the order gets the one that favours the client.
    orderBy: { percentOff: 'desc' },
    select: { label: true, percentOff: true, departmentKey: true },
  })
}

/**
 * @param orderId   the order to seed — freshly created, or one whose
 *                  production company just changed
 * @param companyId the client it belongs to — pass null and nothing happens
 * @param db        pass the transaction client when seeding inside the
 *                  order-create transaction, so a failed insert rolls the
 *                  discounts back with it
 */
export async function applyStandingDiscounts(
  orderId: string,
  companyId: string | null | undefined,
  db: Db = defaultPrisma,
): Promise<SeededDiscount[]> {
  if (!companyId) return []

  const standing = await activeStandingDepartmentDiscounts(companyId, db)
  if (standing.length === 0) return []

  const existing = await db.orderDiscount.findMany({
    where: { orderId, scope: 'DEPARTMENT' },
    select: { departmentKey: true },
  })
  const taken = new Set(existing.map((e) => e.departmentKey))

  const seeded: SeededDiscount[] = []
  const seenHere = new Set<string>()

  for (const d of standing) {
    const dept = d.departmentKey
    if (!dept || taken.has(dept) || seenHere.has(dept)) continue
    // A department that carries no discount at any scope. Seeding one made
    // a row computeOrderTotals zeroes — a discount printed on the quote
    // and worth nothing. Legacy rows still exist; the order page's
    // standing-deal reminder reports them rather than hiding them.
    if (!isDiscountableDepartment(dept)) continue
    if (!Number.isFinite(d.percentOff) || d.percentOff <= 0 || d.percentOff > 100) continue
    seenHere.add(dept)

    await db.orderDiscount.create({
      data: {
        orderId,
        scope: 'DEPARTMENT',
        departmentKey: dept,
        type: 'PERCENT',
        value: d.percentOff,
        // The label prints on the quote and the invoice, so it says what
        // the client agreed to rather than a bare "Discount".
        label: d.label,
      },
    })
    seeded.push({ departmentKey: dept, percentOff: d.percentOff, label: d.label })
  }

  return seeded
}
