/**
 * Shared audit-log writer for OrderLineItem mutations.
 *
 * Per the post-BOOKED editability ratification: every line-item
 * add/update/remove on an order whose status is post-APPROVED must
 * leave a paper trail. DRAFT and QUOTE_SENT edits are NOT logged —
 * those are normal quote-building churn, not post-commitment changes.
 *
 * Mirrors the AuditLog shape used by `bookOrder.ts:214` and
 * `dates/apply/route.ts:218` so the AuditLog stream stays uniform.
 *
 * Three actions:
 *   order.line_item_added    — POST   /api/orders/[id]/line-items
 *   order.line_item_updated  — PUT    /api/orders/[id]/line-items/[lineId]
 *   order.line_item_removed  — DELETE /api/orders/[id]/line-items/[lineId]
 *
 * Non-fatal: the audit write is wrapped in a try/catch so a failed
 * audit never blocks a successful edit. Logged to console for the
 * cron-driven audit-completeness check (Phase 2.5 work) to pick up.
 */

import type { NextRequest } from 'next/server'
import type { OrderStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Order statuses where line-item edits get audit-logged. Anything in
 * this set indicates the order has reached a committed state and an
 * edit needs to leave a trail.
 *
 * APPROVED is INCLUDED (Phase 1 step 2) — kills the "audited island"
 * gap and matches the rest of the codebase's treatment of APPROVED
 * as a committed pre-book state (dates/apply path, postBooking UI
 * gate, jobs-rollup). The semantic: APPROVED means "client signed the
 * rental agreement," so edits from this moment onward deviate from
 * what they signed and MUST leave a paper trail.
 *
 * Excludes DRAFT, QUOTE_SENT (pre-commitment quote churn — no audit)
 * and CANCELLED (terminal, edits shouldn't reach the endpoint).
 */
const AUDITED_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'APPROVED',
  'BOOKED',
  'LOADED_READY',
  'ON_JOB',
  'RETURNED',
  'LD_CHECK',
  'INVOICED', // edits here should be blocked elsewhere, but defensive
  'CLOSED',   // same
])

export function shouldAuditLineItemEdit(status: OrderStatus): boolean {
  return AUDITED_STATUSES.has(status)
}

/** Resolve the operator's userId from the session email. Returns null
 *  on miss — AuditLog.userId is nullable, so a missed lookup falls
 *  back to a "no-user" audit row rather than failing the edit. */
export async function resolveOperatorId(sessionEmail: string | null | undefined): Promise<string | null> {
  if (!sessionEmail) return null
  try {
    const u = await prisma.user.findUnique({
      where: { email: sessionEmail },
      select: { id: true },
    })
    return u?.id ?? null
  } catch {
    return null
  }
}

/** Standard ipAddress extraction — mirrors bookOrder's pattern. */
export function extractIp(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  )
}

export interface LineItemAuditPayload {
  orderId: string
  /** Order status AT THE MOMENT OF EDIT. If not in `AUDITED_STATUSES`,
   *  the helper returns early without writing. Callers don't need to
   *  pre-check — pass it through and let the helper gate. */
  orderStatus: OrderStatus
  action: 'order.line_item_added' | 'order.line_item_updated' | 'order.line_item_removed'
  /** Pre-edit snapshot. For ADDED this is `null`; for UPDATED this is
   *  the line as it was before the patch; for REMOVED this is the
   *  full row that's about to be deleted. */
  oldValues: Prisma.InputJsonValue | null
  /** Post-edit snapshot. For ADDED this is the new row; for UPDATED
   *  this is the patched row; for REMOVED this is `null`. */
  newValues: Prisma.InputJsonValue | null
  userId: string | null
  ipAddress: string | null
}

/**
 * Writes a single AuditLog row when the order is in an audited
 * status. No-op (returns silently) for DRAFT/QUOTE_SENT/APPROVED.
 * Non-fatal — never throws past the caller.
 */
export async function auditLineItemEdit(payload: LineItemAuditPayload): Promise<void> {
  if (!shouldAuditLineItemEdit(payload.orderStatus)) return
  try {
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        ipAddress: payload.ipAddress,
        action: payload.action,
        entityType: 'Order',
        entityId: payload.orderId,
        oldValues: payload.oldValues ?? undefined,
        newValues: payload.newValues ?? undefined,
      },
    })
  } catch (err) {
    // Non-fatal: a failed audit must not block a successful edit, but
    // we surface the error so the audit-completeness cron can flag it.
    console.error(
      `[audit] ${payload.action} on order ${payload.orderId} failed:`,
      err instanceof Error ? err.message : err,
    )
  }
}
