/**
 * A partner's booking was CANCELLED and the line is ours again — but nothing
 * put it on the pick list.
 *
 * Partner lines stay off the pick list (partnerLines.ts), and that routing is
 * decided when a line is added, booked or bound. Cancelling the partner's
 * booking afterwards changes none of it, so if SirReel fills the line from its
 * own shelf the warehouse is never told. Wes 2026-09-11, on that gap: "there
 * needs to be a warning wired in."
 *
 * A line waiting here:
 *   - is physical gear in a warehouse department, with no lane
 *   - has no live partner booking (itself or the line it rides under)
 *   - had a partner ROSTER booking that is now CANCELLED (itself or parent)
 *   - is on an order the warehouse is working: booked through on-job, or a
 *     pull order already released before booking. Earlier than that, booking
 *     routes the line by itself, so there is nothing to warn about.
 * Cancelling the ORDER cancels its partner bookings too; a cancelled order is
 * not live, so it never warns.
 *
 * Read by the order page's prompt (one click puts it on the list) and by the
 * action item. Putting it on the list, removing the line, or booking a partner
 * again all clear it.
 */
import type { OrderStatus, Prisma, PrismaClient } from '@prisma/client'
import { WAREHOUSE_DEPARTMENTS } from '@/lib/jobs/stage'
import { PARTNER_LINE_WHERE } from '@/lib/orders/partnerLines'
import { syncPickListOnLineAdd } from '@/lib/orders/pickListSync'

type Db = PrismaClient | Prisma.TransactionClient

const CANCELLED_ROSTER: Prisma.SubRentalWhereInput = { subcontractedVehicleId: { not: null }, status: 'CANCELLED' }

/** The warehouse is pulling for these. */
export const WAREHOUSE_WORKING: OrderStatus[] = ['BOOKED', 'LOADED_READY', 'ON_JOB']
const PRE_BOOK: OrderStatus[] = ['DRAFT', 'QUOTE_SENT', 'APPROVED']

export const PARTNER_CANCELLED_LINE_WHERE: Prisma.OrderLineItemWhereInput = {
  AND: [
    { type: { notIn: ['FEE', 'DISCOUNT', 'LABOR'] } },
    { department: { in: WAREHOUSE_DEPARTMENTS } },
    { fulfillmentLane: null },
    { NOT: PARTNER_LINE_WHERE },
    { OR: [{ subRentals: { some: CANCELLED_ROSTER } }, { parentLineItem: { is: { subRentals: { some: CANCELLED_ROSTER } } } }] },
    {
      order: {
        archivedAt: null,
        OR: [
          { status: { in: WAREHOUSE_WORKING } },
          { status: { in: PRE_BOOK }, pickList: { is: { releasedAt: { not: null } } } },
        ],
      },
    },
  ],
}

export interface PartnerCancelledLine {
  lineId: string
  orderId: string
  orderNumber: string
  orderStatus: OrderStatus
  description: string
  quantity: number
  pickupDate: Date
  department: string
  vendorName: string | null
  unitName: string | null
  /** When the partner's booking was cancelled (its last update). */
  cancelledAt: Date | null
}

const CANCELLED_BOOKING_SELECT = {
  where: CANCELLED_ROSTER,
  orderBy: { updatedAt: 'desc' as const },
  take: 1,
  select: { updatedAt: true, itemDescription: true, vendor: { select: { name: true } }, subcontractedVehicle: { select: { name: true } } },
}

export async function findPartnerCancelledLines(
  db: Db,
  opts: { orderId?: string; lineId?: string } = {},
): Promise<PartnerCancelledLine[]> {
  const rows = await db.orderLineItem.findMany({
    where: {
      AND: [
        PARTNER_CANCELLED_LINE_WHERE,
        ...(opts.orderId ? [{ orderId: opts.orderId }] : []),
        ...(opts.lineId ? [{ id: opts.lineId }] : []),
      ],
    },
    orderBy: [{ pickupDate: 'asc' }, { sortOrder: 'asc' }],
    select: {
      id: true, orderId: true, description: true, quantity: true, pickupDate: true, department: true,
      order: { select: { orderNumber: true, status: true } },
      subRentals: CANCELLED_BOOKING_SELECT,
      parentLineItem: { select: { subRentals: CANCELLED_BOOKING_SELECT } },
    },
  })
  return rows.map((r) => {
    const s = r.subRentals[0] ?? r.parentLineItem?.subRentals[0] ?? null
    return {
      lineId: r.id,
      orderId: r.orderId,
      orderNumber: r.order.orderNumber,
      orderStatus: r.order.status,
      description: r.description,
      quantity: r.quantity,
      pickupDate: r.pickupDate,
      department: r.department,
      vendorName: s?.vendor.name ?? null,
      unitName: s?.subcontractedVehicle?.name ?? s?.itemDescription ?? null,
      cancelledAt: s?.updatedAt ?? null,
    }
  })
}

/** Loud once the gear is going out: loaded or on the job, or picking up within
 *  three days. Pure; pickupDate is a @db.Date, compared as a calendar day. */
export function partnerCancelledPriority(status: OrderStatus, pickupDate: Date, now = new Date()): 'high' | 'medium' {
  if (status === 'LOADED_READY' || status === 'ON_JOB') return 'high'
  const pickup = Date.UTC(pickupDate.getUTCFullYear(), pickupDate.getUTCMonth(), pickupDate.getUTCDate())
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((pickup - today) / 86_400_000) <= 3 ? 'high' : 'medium'
}

/** The one-click fix: file the line the way any of our lines is filed.
 *  Refuses a line that is not (or no longer) waiting. */
export async function putPartnerCancelledLineOnPickList(
  db: Db,
  lineId: string,
  by: { userId: string | null; ipAddress?: string | null },
): Promise<{ ok: true; pickListAction: string } | { ok: false; reason: string }> {
  const [line] = await findPartnerCancelledLines(db, { lineId })
  if (!line) return { ok: false, reason: 'That line is no longer waiting to go on the pick list.' }
  const res = await syncPickListOnLineAdd(db, {
    orderId: line.orderId,
    orderLineItemId: line.lineId,
    department: line.department as Parameters<typeof syncPickListOnLineAdd>[1]['department'],
    partnerFulfilled: false,
  })
  await db.auditLog.create({
    data: {
      userId: by.userId,
      ipAddress: by.ipAddress ?? null,
      action: 'order.partner_cancelled_line_to_pick_list',
      entityType: 'OrderLineItem',
      entityId: line.lineId,
      newValues: {
        orderId: line.orderId, orderNumber: line.orderNumber, vendorName: line.vendorName, unitName: line.unitName,
        lane: res.lane, pickListAction: res.pickListAction,
      },
    },
  })
  return { ok: true, pickListAction: res.pickListAction }
}
