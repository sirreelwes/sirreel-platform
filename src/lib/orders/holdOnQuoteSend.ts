/**
 * Soft-hold the fleet a quote commits us to (Wes 2026-08-25).
 *
 * "When we send a quote out, a hold is implied — because if they accept
 * and we've rented that vehicle to someone else, we'd be in a bad place."
 * Before this, sending a quote reserved nothing: an approved order and
 * even a BOOKED one could exist with the unit showing free on the board.
 *
 * SOFT, not firm. Holds are created as backups (holdRank 2) so the unit
 * reads as spoken-for on the Reservations board without hard-blocking —
 * a quote that never converts must not freeze a truck. Approval promotes
 * them to rank 1 (see promoteHoldsOnApproval).
 *
 * Only UNIT-TRACKED lines are held. Quote lines carry an InventoryItem,
 * NOT an AssetCategory — an early version of this filtered on
 * `assetCategoryId` and would have silently held NOTHING, including the
 * one real Cargo Van it was written for. The signal that matters lives on
 * the catalog row: trackingMode=UNIT_TRACKED plus a legacyAssetCategoryId
 * to hold against. Supplies (ladders, folding tables, costume racks) are
 * QUANTITY-tracked and are correctly skipped — that's why the four "gaps"
 * found on 2026-08-25 were really one.
 *
 * Idempotent by (booking, category, window): re-sending a quote must not
 * stack duplicate holds.
 *
 * NON-FATAL by contract. The caller sends the email first; a hold failure
 * must never make a delivered quote look like it failed.
 */

import { prisma } from '@/lib/prisma'
import { LineItemDepartment } from '@prisma/client'

export interface HoldOnQuoteResult {
  created: number
  reused: number
  skippedNoDates: number
  skippedNotUnitTracked: number
  error: string | null
}

export async function holdOnQuoteSend(orderId: string): Promise<HoldOnQuoteResult> {
  const out: HoldOnQuoteResult = {
    created: 0, reused: 0, skippedNoDates: 0, skippedNotUnitTracked: 0, error: null,
  }
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, jobId: true, companyId: true, agentId: true, bookingId: true,
        job: { select: { name: true } },
        lineItems: {
          select: {
            quantity: true, pickupDate: true, returnDate: true, assetCategoryId: true,
            description: true,
            assetCategory: { select: { id: true, department: true } },
            inventoryItem: {
              select: { department: true, trackingMode: true, legacyAssetCategoryId: true },
            },
          },
        },
      },
    })
    if (!order) return { ...out, error: 'order not found' }

    /** The AssetCategory this line should hold against, or null. */
    const categoryFor = (li: (typeof order.lineItems)[number]): string | null => {
      // Legacy lines that carry the category directly.
      if (li.assetCategoryId) {
        const d = li.assetCategory?.department
        return d === LineItemDepartment.VEHICLES || d === LineItemDepartment.STAGES
          ? li.assetCategoryId
          : null
      }
      // Current lines: resolve through the catalog row.
      const inv = li.inventoryItem
      if (!inv || inv.trackingMode !== 'UNIT_TRACKED') return null
      if (inv.department !== LineItemDepartment.VEHICLES && inv.department !== LineItemDepartment.STAGES) return null
      return inv.legacyAssetCategoryId ?? null
    }

    const holdable = order.lineItems
      .map((li) => ({ li, categoryId: categoryFor(li) }))
      .filter(({ li, categoryId }) => {
        if (!categoryId) { out.skippedNotUnitTracked++; return false }
        if (!li.pickupDate || !li.returnDate) { out.skippedNoDates++; return false }
        return true
      })
    if (holdable.length === 0) return out

    // One Booking per order, reused across re-sends.
    let bookingId = order.bookingId
    if (!bookingId) {
      const existing = order.jobId
        ? await prisma.booking.findFirst({
            where: { jobId: order.jobId, source: 'AGENT_DIRECT' },
            select: { id: true },
          })
        : null
      if (existing) bookingId = existing.id
    }
    if (!bookingId) {
      // A Booking needs a contact; fall back to the job's primary or any
      // person on the company rather than failing the hold outright.
      const person = await prisma.person.findFirst({
        where: { affiliations: { some: { companyId: order.companyId, isCurrent: true } } },
        select: { id: true },
      })
      if (!person) return { ...out, error: 'no contact on the company to attach a booking to' }
      const created = await prisma.booking.create({
        data: {
          bookingNumber: `SR-Q-${Date.now()}`,
          companyId: order.companyId,
          personId: person.id,
          agentId: order.agentId,
          jobId: order.jobId,
          jobName: order.job?.name ?? 'Quote hold',
          startDate: holdable[0].li.pickupDate!,
          endDate: holdable[0].li.returnDate!,
          source: 'AGENT_DIRECT',
          status: 'REQUEST',
        },
        select: { id: true },
      })
      bookingId = created.id
      await prisma.order.update({ where: { id: order.id }, data: { bookingId } })
    }

    for (const { li, categoryId } of holdable) {
      const dupe = await prisma.bookingItem.findFirst({
        where: {
          bookingId,
          categoryId: categoryId!,
          status: { in: ['REQUESTED', 'ASSIGNED'] },
        },
        select: { id: true },
      })
      if (dupe) { out.reused++; continue }
      await prisma.bookingItem.create({
        data: {
          bookingId,
          categoryId: categoryId!,
          quantity: li.quantity || 1,
          dailyRate: 0,
          status: 'REQUESTED',
          // Backup rank: visible as spoken-for, doesn't hard-block.
          holdRank: 2,
        },
      })
      out.created++
    }
    return out
  } catch (e) {
    return { ...out, error: e instanceof Error ? e.message : 'hold failed' }
  }
}

/**
 * Promote a quote's soft holds to firm when the client approves.
 *
 * The quote-send hold is rank 2 (spoken-for, non-blocking). Approval is
 * the client saying yes, so the hold becomes rank 1 and blocks properly.
 * Also non-fatal: an approval must land even if the promotion doesn't.
 */
export async function promoteHoldsOnApproval(orderId: string): Promise<{ promoted: number; error: string | null }> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { bookingId: true, jobId: true },
    })
    if (!order) return { promoted: 0, error: 'order not found' }

    const bookingIds: string[] = []
    if (order.bookingId) bookingIds.push(order.bookingId)
    else if (order.jobId) {
      const rows = await prisma.booking.findMany({
        where: { jobId: order.jobId, source: 'AGENT_DIRECT' },
        select: { id: true },
      })
      bookingIds.push(...rows.map((r) => r.id))
    }
    if (bookingIds.length === 0) return { promoted: 0, error: null }

    const res = await prisma.bookingItem.updateMany({
      where: { bookingId: { in: bookingIds }, holdRank: 2, status: 'REQUESTED' },
      data: { holdRank: 1 },
    })
    return { promoted: res.count, error: null }
  } catch (e) {
    return { promoted: 0, error: e instanceof Error ? e.message : 'promote failed' }
  }
}
