/**
 * Binding a partner booking to the order line it fulfils.
 *
 * Wes 2026-09-07, on finding a $24/day damage waiver offered against King
 * Kong's motorhome: "close it."
 *
 * ── Why the gap existed ─────────────────────────────────────────────────
 * There are two ways a SubRental comes into being, and only one of them
 * knows a line:
 *   A) from the LINE — the "Sub-rent…" button on an order line. The link is
 *      set at creation and is always right.
 *   B) from the VEHICLE — `createPotentialSubRental`, fired when a partner
 *      unit is quoted. A quote exists before any order does, so the row
 *      hangs off the JOB with no order and no line. Nothing ever went back
 *      and linked it once the order appeared.
 *
 * `SubRental.orderLineItemId` is not bookkeeping. Every LCDW path asks
 * `line.subRentals.length > 0` to decide whether a vehicle is ours to
 * insure, so an unlinked partner unit reads as a SirReel vehicle and HQ
 * offers a waiver on a coach we do not own — the exact thing the rental
 * agreement excludes. The driver true-up reads the same link.
 *
 * ── The rule: bind on certainty, flag on doubt ──────────────────────────
 * A wrong link moves money, so this never picks between candidates. It
 * binds only when the order has EXACTLY ONE unclaimed vehicle line whose
 * description matches the partner unit's name. Anything else — no match,
 * several matches, every candidate already claimed — is left null and
 * reported, and the surfaces say so out loud rather than assuming.
 */
import { prisma } from '@/lib/prisma'
import { releasePartnerLineFromPickList } from '@/lib/orders/pickListSync'

export type BindResult =
  | { bound: true; orderLineItemId: string; already: boolean }
  | { bound: false; reason: string }

/** Loose enough for "EcoFlux" vs "EcoFlux — Celebrity Motorhome", strict
 *  enough that two different units never both match. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
function nameMatches(unitName: string, lineDescription: string): boolean {
  const u = norm(unitName)
  const l = norm(lineDescription)
  if (!u || !l) return false
  return l === u || l.startsWith(`${u} `) || l.includes(` ${u} `) || l.endsWith(` ${u}`)
}

/**
 * Link a sub-rental to the order line it fulfils, when that can be known
 * for certain. Safe to call repeatedly; a row that is already linked is
 * reported as `already`.
 */
export async function bindSubRentalToOrderLine(subRentalId: string): Promise<BindResult> {
  const sub = await prisma.subRental.findUnique({
    where: { id: subRentalId },
    select: {
      id: true, orderId: true, orderLineItemId: true, itemDescription: true, status: true, subcontractedVehicleId: true,
      subcontractedVehicle: { select: { name: true } },
    },
  })
  if (!sub) return { bound: false, reason: 'sub-rental not found' }
  if (sub.orderLineItemId) return { bound: true, orderLineItemId: sub.orderLineItemId, already: true }
  if (!sub.orderId) return { bound: false, reason: 'no order on the sub-rental yet' }

  const unitName = sub.subcontractedVehicle?.name ?? sub.itemDescription
  if (!unitName) return { bound: false, reason: 'the sub-rental names no unit' }

  const lines = await prisma.orderLineItem.findMany({
    where: { orderId: sub.orderId, type: { in: ['VEHICLE', 'EQUIPMENT'] }, parentLineItemId: null },
    select: { id: true, description: true, subRentals: { select: { id: true } } },
  })
  // A line another booking already fulfils is not a candidate.
  const free = lines.filter((l) => l.subRentals.length === 0)
  const matches = free.filter((l) => nameMatches(unitName, l.description))
  if (matches.length === 0) {
    return { bound: false, reason: `no unclaimed line on the order matches "${unitName}"` }
  }
  if (matches.length > 1) {
    return { bound: false, reason: `${matches.length} lines match "${unitName}" — link it by hand so the right one is billed` }
  }

  const target = matches[0]
  await prisma.subRental.update({ where: { id: sub.id }, data: { orderLineItemId: target.id } })
  // A partner's roster unit never passes through our warehouse. The line was
  // filed as ours when it was added; take it back off (partnerLines.ts).
  if (sub.subcontractedVehicleId) {
    await releasePartnerLineFromPickList(prisma, target.id).catch(() => null)
  }
  await prisma.auditLog.create({
    data: {
      action: 'sub_rental.linked_to_line',
      entityType: 'SubRental',
      entityId: sub.id,
      oldValues: { orderLineItemId: null },
      newValues: { orderLineItemId: target.id, matchedOn: unitName, lineDescription: target.description, via: 'auto-bind' },
    } as never,
  }).catch(() => {})
  return { bound: true, orderLineItemId: target.id, already: false }
}

/**
 * Live partner bookings on an order that are still not linked to a line.
 * The surfaces that depend on the link (LCDW, driver true-up) read this so
 * they can say "this may be wrong" instead of quietly being wrong.
 */
export async function unlinkedPartnerUnits(orderId: string): Promise<Array<{ id: string; unitName: string; vendorName: string }>> {
  const rows = await prisma.subRental.findMany({
    where: { orderId, orderLineItemId: null, status: { not: 'CANCELLED' } },
    select: { id: true, itemDescription: true, subcontractedVehicle: { select: { name: true } }, vendor: { select: { name: true } } },
  })
  return rows.map((r) => ({ id: r.id, unitName: r.subcontractedVehicle?.name ?? r.itemDescription ?? 'a unit', vendorName: r.vendor.name }))
}
