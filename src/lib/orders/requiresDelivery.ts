/**
 * "This order holds something we have to deliver and collect."
 *
 * Wes 2026-08-28: a restroom trailer can't be a will-call — a client cannot
 * tow one. An order carrying one that isn't marked for delivery AND pickup is
 * an order with no truck booked, and nobody finds out until the morning of.
 *
 * The rule lives on AssetCategory.requiresDelivery rather than on a hardcoded
 * "DLUX" string, so flagging the next tow-behind category is a data change,
 * not a deploy.
 *
 * ── Why description matching, and why it's narrow ───────────────────────────
 * Matching on `assetCategoryId` alone would be cleaner and would also have
 * missed the order that prompted this: on S260828-001 BOTH lines were typed
 * as free text with assetCategoryId null, because the picker isn't mandatory.
 * A suggestion that only fires on well-formed data is worthless precisely
 * where it's needed.
 *
 * So the fallback compares the line's description to the category NAME, both
 * normalized, and requires the full category name to appear — "2 Unit
 * Restroom Trailer" matches "2 unit restroom trailer (x2)", while a line
 * merely mentioning "restroom" does not. It can only ever produce a
 * suggestion the rep accepts or ignores; nothing is written from a match, so
 * a false positive costs one dismissed prompt, not a phantom delivery.
 */
import { prisma } from '@/lib/prisma'

export interface DeliveryRequirement {
  /** Categories on this order that we have to deliver + collect. */
  reasons: string[]
  /** True when at least one line requires it. */
  required: boolean
  /** Requirement met — both flags already set. */
  satisfied: boolean
  deliveryRequested: boolean
  pickupRequested: boolean
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export async function deliveryRequirementForOrder(orderId: string): Promise<DeliveryRequirement | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      deliveryRequested: true,
      pickupRequested: true,
      lineItems: { select: { description: true, assetCategoryId: true } },
    },
  })
  if (!order) return null

  const categories = await prisma.assetCategory.findMany({
    where: { requiresDelivery: true },
    select: { id: true, name: true },
  })

  const hit = new Set<string>()
  for (const line of order.lineItems) {
    const desc = normalize(line.description ?? '')
    for (const cat of categories) {
      if (line.assetCategoryId === cat.id || (desc && desc.includes(normalize(cat.name)))) {
        hit.add(cat.name)
      }
    }
  }

  const reasons = [...hit]
  return {
    reasons,
    required: reasons.length > 0,
    satisfied: order.deliveryRequested && order.pickupRequested,
    deliveryRequested: order.deliveryRequested,
    pickupRequested: order.pickupRequested,
  }
}
