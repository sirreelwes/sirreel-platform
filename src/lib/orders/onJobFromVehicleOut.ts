/**
 * A vehicle leaving the yard is the "order is out" moment.
 *
 * Wes, 2026-09-07 (Forgotten Island / S260905-001): the driver had
 * checked Cube 29 out on the blind pickup the night before, and the job
 * still read "Booked · Ready to go out" the next morning. The check-out
 * wrote BookingAssignment CHECKED_OUT and DriverAssignment PICKED_UP but
 * never touched the ORDER — and the order is what the job's cadence
 * reads. The only path to ON_JOB was the manual "Mark On Job" button,
 * which only appears once an order is LOADED_READY.
 *
 * So: whenever an assignment goes CHECKED_OUT, the orders that vehicle
 * carries advance BOOKED / LOADED_READY → ON_JOB here. APPROVED is left
 * alone on purpose — booking snapshots money and routes lanes
 * (bookOrder.ts); a driver's token must not do that. Instead bookOrder
 * calls the same helper AFTER booking, so "Book it" on an order whose
 * truck already left lands on ON_JOB, not on a stale BOOKED.
 *
 * Which orders a vehicle "carries": the ones whose bookingId is the
 * assignment's booking. When none match and the job has exactly one live
 * order, that one — a rebook or a superseded twin hold orphans
 * Order.bookingId (see the paperwork-link-follows-rebook note), and a
 * one-order job leaves no ambiguity about whose truck it is. A multi-
 * order job with a dangling link advances nothing; the manual button
 * still exists for that.
 */
import type { Prisma, OrderStatus, PrismaClient } from '@prisma/client'
import { projectCadenceFromOrderStatus } from '@/lib/orders/cadenceProjection'

type Db = Prisma.TransactionClient | PrismaClient

/** Statuses a check-out may move forward. Anything else is not ours to touch. */
export const ADVANCEABLE_TO_ON_JOB: readonly OrderStatus[] = ['BOOKED', 'LOADED_READY']

export interface CarriedOrder {
  id: string
  orderNumber: string
  status: OrderStatus
}

export async function ordersCarriedByBooking(db: Db, jobId: string, bookingId: string): Promise<CarriedOrder[]> {
  const live = await db.order.findMany({
    where: { jobId, status: { not: 'CANCELLED' } },
    select: { id: true, orderNumber: true, status: true, bookingId: true },
  })
  const linked = live.filter((o) => o.bookingId === bookingId)
  if (linked.length) return linked
  return live.length === 1 ? live : []
}

export interface AdvanceOnJobInput {
  jobId: string | null | undefined
  bookingId: string
  bookingAssignmentId: string
  userId: string | null
  /** For the audit row — who or what said the truck left. */
  source: 'driver-self-checkout' | 'book-after-vehicle-out'
}

/**
 * Flip the carried BOOKED / LOADED_READY orders to ON_JOB, one audit row
 * each. Returns the ids that moved so the caller can project cadence once
 * its own transaction has committed (projection runs its own).
 */
export async function advanceOrdersToOnJob(db: Db, input: AdvanceOnJobInput): Promise<string[]> {
  if (!input.jobId) return []
  const carried = await ordersCarriedByBooking(db, input.jobId, input.bookingId)
  const moved: string[] = []
  for (const o of carried) {
    if (!ADVANCEABLE_TO_ON_JOB.includes(o.status)) continue
    // Status-guarded updateMany: a second check-out on the same booking
    // (two trucks, two drivers) must not re-stamp an order already out.
    const r = await db.order.updateMany({
      where: { id: o.id, status: { in: [...ADVANCEABLE_TO_ON_JOB] } },
      data: { status: 'ON_JOB' },
    })
    if (r.count === 0) continue
    moved.push(o.id)
    await db.auditLog.create({
      data: {
        userId: input.userId,
        action: 'order.on_job_by_vehicle_out',
        entityType: 'Order',
        entityId: o.id,
        oldValues: { status: o.status },
        newValues: {
          status: 'ON_JOB',
          bookingAssignmentId: input.bookingAssignmentId,
          bookingId: input.bookingId,
          source: input.source,
        },
      },
    })
  }
  return moved
}

/** Post-commit: IN_PROGRESS on the cadence ladder. Never throws. */
export async function projectOnJob(orderIds: string[]): Promise<void> {
  for (const id of orderIds) {
    try {
      await projectCadenceFromOrderStatus(id, 'ON_JOB')
    } catch (err) {
      console.error('[onJobFromVehicleOut] cadence projection failed', { id, err })
    }
  }
}
