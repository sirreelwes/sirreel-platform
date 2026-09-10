/**
 * The gear coming back is the "order is returned" moment.
 *
 * The inbound sibling of onJobFromVehicleOut.ts, and it exists for the
 * same reason: the ORDER is what the job's cadence and the whole money
 * arc read, and until now nothing automatic ever advanced it to
 * RETURNED. The only writers were a human picking the status on the
 * order page and the reopen route walking one back.
 *
 * That mattered more than a stale pill. S260905-002 (SR-JOB-0312 "BM"),
 * measured 2026-09-09: every warehouse line RETURNED, the pick list
 * CHECKED_IN, Job.returnedAt stamped, a complete inbound sheet filed —
 * and an invoice for $630 already SENT to the client while the order
 * still said BOOKED. sendInvoice advances the order only
 * `if (invoice.order.status === 'RETURNED')`, so the advance was skipped
 * in silence; recordPayment then advances INVOICED → CLOSED and nothing
 * else. An order that never passes through RETURNED can be invoiced AND
 * paid in full and read BOOKED for ever. The /jobs board read "Booked"
 * for it too — a finished job presented as one that has not gone out,
 * which is the direction that gets gear re-picked.
 *
 * So a filed, complete check-IN sheet says the same thing here that the
 * check-OUT sheet says on the way out.
 *
 * Why RETURNED and not LD_CHECK. LD_CHECK is a declared OrderStatus with
 * ZERO writers anywhere in the app, sendInvoice advances only from
 * RETURNED (so an order parked in LD_CHECK could never reach INVOICED),
 * and jobs/cadence.ts renders LD_CHECK as 'invoiced' — a just-returned
 * job would read "Invoiced" before anybody billed it. Missing GEAR has
 * no L&D model to park in either: DamageItem hangs off an Inspection and
 * is vehicle-scoped (locationOnVehicle), so LdDispositionPanel renders
 * empty for a short case.
 *
 * Why a SHORT line still advances. Short means it came back short, not
 * that it has not come back. settleGearAfterReport already stamps
 * Job.returnedAt on a complete short sheet and the billing queue already
 * carries checkInDifferences to Ana without gating on it, so holding the
 * order at BOOKED would block invoicing a rental that is owed regardless
 * and park it in the one state where the shortfall is least visible. The
 * shortfall's home is the agent flag and Ana's row. A PARTIAL sheet is
 * the real do-nothing case, and settleGearAfterReport returns before it
 * ever gets here.
 */
import type { Prisma, OrderStatus, PrismaClient } from '@prisma/client'
import { projectCadenceFromOrderStatus } from '@/lib/orders/cadenceProjection'
import { prisma } from '@/lib/prisma'

type Db = Prisma.TransactionClient | PrismaClient

/**
 * Statuses an inbound sheet may move forward.
 *
 * BOOKED is in because it has to be: the outbound half of this only
 * shipped on 2026-09-09, so every order that went out on paper before
 * that is still sitting at BOOKED and would otherwise never come back.
 * Going BOOKED → RETURNED skips ON_JOB, which is honest — it did go out
 * and it did come home; nobody recorded the middle.
 *
 * The pre-booked three (DRAFT / QUOTE_SENT / APPROVED) are deliberately
 * OUT, the same line the outbound edge holds: booking snapshots money and
 * routes lanes, and the yard does not price work. An order that came back
 * still in quote form stays there — Ana's billing queue already carries
 * it (BILLABLE_STATUSES includes all three) and says NOT_BOOKED.
 */
export const ADVANCEABLE_TO_RETURNED: readonly OrderStatus[] = ['BOOKED', 'LOADED_READY', 'ON_JOB']

/** For the audit row — what said the order came back. */
export type ReturnedSource = 'gear-check-in-sheet'

export interface ReturningOrder {
  id: string
  orderNumber: string
  status: OrderStatus
}

/**
 * Move ONE order to RETURNED. Status-guarded updateMany rather than
 * update, so a corrected re-file — or a second sheet on the same order —
 * cannot re-stamp one already back. Returns true only when THIS call is
 * what moved it.
 */
export async function advanceOneOrderToReturned(
  db: Db,
  order: ReturningOrder,
  userId: string | null,
  source: ReturnedSource,
  /** Extra provenance for the audit row — the report. */
  detail: Record<string, string> = {},
): Promise<boolean> {
  if (!ADVANCEABLE_TO_RETURNED.includes(order.status)) return false
  const r = await db.order.updateMany({
    where: { id: order.id, status: { in: [...ADVANCEABLE_TO_RETURNED] } },
    data: { status: 'RETURNED' },
  })
  if (r.count === 0) return false
  await db.auditLog.create({
    data: {
      userId,
      action: 'order.returned_by_check_in',
      entityType: 'Order',
      entityId: order.id,
      oldValues: { status: order.status },
      newValues: { status: 'RETURNED', source, ...detail },
    },
  })
  return true
}

/**
 * Post-commit: everything the manual RETURNED transition on the order
 * page does besides the status write, so a sheet-driven return is not a
 * quieter version of the same event.
 *
 *   1. RETURNED on the cadence ladder. Sends nothing — EVENT_PLAN has no
 *      RETURNED entry, and RETURN_ACKNOWLEDGMENT / WRAP_THANKS_T24 have
 *      templates but no scheduler anywhere. What it does do is clear
 *      unfired events, which drops a stale RETURN_REMINDER_T24 for gear
 *      that is already on the shelf.
 *   2. The thank-you suggestion, exactly as PUT /api/orders/[id] mints it
 *      — a SUGGESTED row a human reviews and sends, never an auto-send.
 *      Idempotent on the unique orderId, so a re-file does not re-mint.
 *
 * Never throws: the sheet is the yard's work and must not fail because a
 * downstream nicety did.
 */
export async function projectReturned(orderIds: string[]): Promise<void> {
  for (const id of orderIds) {
    try {
      await projectCadenceFromOrderStatus(id, 'RETURNED')
    } catch (err) {
      console.error('[returnedFromCheckIn] cadence projection failed', { id, err })
    }
    try {
      await prisma.thankYouSuggestion.upsert({ where: { orderId: id }, create: { orderId: id }, update: {} })
    } catch (err) {
      console.error('[returnedFromCheckIn] thank-you suggestion mint failed', { id, err })
    }
  }
}
