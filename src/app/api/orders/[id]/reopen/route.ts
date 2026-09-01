import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders/[id]/reopen — put a finished order back in an
 * editable state.
 *
 * Wes 2026-09-01: "How can I go back in after I've wrapped a job and
 * edit discounts etc if we find a mistake."
 *
 * Closing was a one-way door. isOrderEditable() locks INVOICED, CLOSED
 * and CANCELLED, the order page renders no buttons for them, and the
 * discounts route refused with "locked to reopen/credit only" — naming
 * a reopen path that did not exist. This is that path.
 *
 * Lands the order back at RETURNED: the last state that is both fully
 * editable and true (the gear IS back). It deliberately does NOT rewind
 * to BOOKED or ON_JOB, which would be a lie about where the gear is and
 * would re-arm the outbound cadence.
 *
 * WHAT IT DOES NOT TOUCH — on purpose:
 *   · Invoices. Invoice.total is a canonical snapshot at issue time;
 *     re-opening the order does not and must not silently rewrite an
 *     invoice the client already holds. If one is live, the response
 *     says so and the caller confirms; voiding or crediting it stays a
 *     separate, deliberate act.
 *   · The booked* snapshot, for the same reason.
 *
 * Gated on `billing` — the people who edit money (ADMIN, AGENT,
 * BILLING). Always audit-logged with the reason, because "who reopened
 * a closed order and why" is exactly the question an audit asks.
 */

const REOPENABLE = new Set(['CLOSED', 'INVOICED'])

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, salesOnly: true },
  })
  if (!actor || !can(actor.role, 'billing')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'Reopening a finished order is a billing action.' },
      { status: 403 },
    )
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      invoices: {
        where: { status: { not: 'VOID' } },
        select: { id: true, invoiceNumber: true, status: true, total: true },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  if (!REOPENABLE.has(order.status)) {
    return NextResponse.json(
      {
        error: 'not reopenable',
        reason:
          order.status === 'CANCELLED'
            ? 'This order was cancelled. Cancelling is not the same as finishing — re-quote instead of reopening.'
            : `This order is ${order.status} and is already editable — no need to reopen it.`,
      },
      { status: 409 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown; confirmInvoiced?: unknown }
  const reason =
    typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null
  if (!reason) {
    return NextResponse.json(
      { error: 'reason required', reason: 'Say what is being corrected — it goes in the audit trail.' },
      { status: 400 },
    )
  }

  // A live invoice does not block the reopen, but it must be an informed
  // choice: the issued document keeps its own total, so the order and
  // the invoice will disagree until someone voids or credits it.
  if (order.invoices.length > 0 && body.confirmInvoiced !== true) {
    return NextResponse.json(
      {
        error: 'invoice outstanding',
        needsConfirm: true,
        reason:
          `This order has ${order.invoices.length} live invoice${order.invoices.length === 1 ? '' : 's'} ` +
          `(${order.invoices.map((i) => i.invoiceNumber).join(', ')}). Reopening does NOT change ` +
          `${order.invoices.length === 1 ? 'it' : 'them'} — the client still holds the issued total. ` +
          `Void or credit separately once the order is corrected.`,
        invoices: order.invoices.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          status: i.status,
          total: Number(i.total),
        })),
      },
      { status: 409 },
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: 'RETURNED' } })
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: 'order.reopened',
        entityType: 'Order',
        entityId: order.id,
        oldValues: { status: order.status },
        newValues: {
          status: 'RETURNED',
          reason,
          liveInvoices: order.invoices.map((i) => i.invoiceNumber),
        },
      },
    })
  })

  return NextResponse.json({
    ok: true,
    orderNumber: order.orderNumber,
    from: order.status,
    status: 'RETURNED',
    liveInvoices: order.invoices.map((i) => i.invoiceNumber),
  })
}
