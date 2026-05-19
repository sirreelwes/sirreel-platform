import { prisma } from '@/lib/prisma'

/**
 * Gate for transitioning an Order to PICKUP_CONFIRMED status.
 *
 * Rule (CRH brief, May 2026): every contract the Order *requires* must
 * be in a SIGNED status before pickup can be confirmed.
 *
 *   - If the order has any STAGE line items (matched by type or by an
 *     asset-category name/slug containing "stage"), a STAGE_CONTRACT
 *     SignedAgreement must exist and be in SIGNED_BASELINE /
 *     SIGNED_NEGOTIATED.
 *   - If the order has any non-stage line items, a RENTAL_AGREEMENT
 *     SignedAgreement must exist and be in SIGNED_BASELINE /
 *     SIGNED_NEGOTIATED.
 *   - Orders with no line items at all are allowed through (defensive —
 *     the rest of the platform won't let an order leave DRAFT without
 *     line items, but if it happens, don't block here).
 *
 * Returns { allowed, blockers }. `blockers` is an empty array when
 * `allowed` is true, otherwise a list of human-readable reasons safe
 * to surface to the rep.
 *
 * NO existing caller invokes this helper yet — Order.status →
 * PICKUP_CONFIRMED transitions today are done manually outside the
 * platform. This function exists so the first caller that wires
 * automated PICKUP_CONFIRMED has a ready-built guard rail. Derivation
 * is line-item based (Order has no contractType column — PaperworkRequest
 * is the only model that does, and it's keyed by booking not order).
 */
export interface PickupConfirmGate {
  allowed: boolean
  blockers: string[]
}

const SIGNED_STATUSES = new Set(['SIGNED_BASELINE', 'SIGNED_NEGOTIATED'])

function isStageLine(li: { type: string; assetCategory: { name: string; slug: string } | null }): boolean {
  return (
    li.type === 'STAGE' ||
    /stage/i.test(li.assetCategory?.name || '') ||
    /stage/i.test(li.assetCategory?.slug || '')
  )
}

export async function canPickupConfirm(orderId: string): Promise<PickupConfirmGate> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      lineItems: {
        select: {
          type: true,
          assetCategory: { select: { name: true, slug: true } },
        },
      },
      signedAgreements: {
        select: { contractType: true, status: true },
      },
    },
  })
  if (!order) return { allowed: false, blockers: ['Order not found'] }

  const requiresStage = order.lineItems.some(isStageLine)
  const requiresRental = order.lineItems.some((li) => !isStageLine(li))

  const blockers: string[] = []
  if (requiresRental) {
    const a = order.signedAgreements.find((x) => x.contractType === 'RENTAL_AGREEMENT')
    if (!a || !SIGNED_STATUSES.has(a.status)) {
      blockers.push(`Rental agreement is not signed yet (currently ${a?.status ?? 'not generated'}).`)
    }
  }
  if (requiresStage) {
    const a = order.signedAgreements.find((x) => x.contractType === 'STAGE_CONTRACT')
    if (!a || !SIGNED_STATUSES.has(a.status)) {
      blockers.push(`Stage contract is not signed yet (currently ${a?.status ?? 'not generated'}).`)
    }
  }

  return { allowed: blockers.length === 0, blockers }
}
