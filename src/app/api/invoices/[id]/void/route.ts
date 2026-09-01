import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/**
 * POST /api/invoices/[id]/void — withdraw an issued invoice.
 *
 * Wes 2026-09-01: a Dreambear invoice went out at $1,324 and the order was
 * then discounted to $1,159.20. Three separate places in the codebase told
 * him what to do about it —
 *
 *   · the order page's drift banner: "Void it and generate a fresh one"
 *   · generateRentalInvoice's 409: "void it before regenerating"
 *   · the reopen route: "voiding or crediting it stays a separate,
 *     deliberate act"
 *
 * — and that act did not exist anywhere in the app. No route set
 * Invoice.status to VOID, so the instruction was a dead end and a wrong
 * invoice could not be corrected at all. This is the missing half.
 *
 * Void, not delete. The row stays, keeps its number, and drops out of AR
 * (collections and the job rollups already filter `status != 'VOID'`).
 * The corrected bill is a NEW invoice with a NEW number, which is what
 * reissuing means — the client can reconcile "30001 voided, 30002 is the
 * real one" in a way that silently mutating 30001 would not allow.
 *
 * Refuses a PAID or part-paid invoice. Money against an invoice makes
 * voiding the wrong instrument: that needs a credit note or a refund, and
 * quietly voiding it would orphan the payment rows and misstate revenue.
 *
 * Gated on `billing` — same audience as reopening a closed order — and
 * always audit-logged with the reason, because "who withdrew an invoice
 * the client was holding, and why" is exactly what an audit asks.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!actor || !can(actor.role, 'billing')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'Voiding an invoice is a billing action.' },
      { status: 403 },
    )
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      total: true,
      amountPaid: true,
      sentAt: true,
      notes: true,
      order: { select: { id: true, orderNumber: true } },
      payments: { select: { id: true, amount: true, voidedAt: true } },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'invoice not found' }, { status: 404 })

  if (invoice.status === 'VOID') {
    return NextResponse.json(
      { error: 'already void', reason: `${invoice.invoiceNumber} is already voided.` },
      { status: 409 },
    )
  }

  // Live payments — a voided payment doesn't count, it was already undone.
  const livePayments = invoice.payments.filter((p) => !p.voidedAt)
  const paid = Number(invoice.amountPaid)
  if (paid > 0 || livePayments.length > 0) {
    return NextResponse.json(
      {
        error: 'invoice has payments',
        reason:
          `${invoice.invoiceNumber} has $${paid.toLocaleString('en-US', { minimumFractionDigits: 2 })} ` +
          `applied to it across ${livePayments.length} payment${livePayments.length === 1 ? '' : 's'}. ` +
          `Voiding would orphan that money. Refund or credit it instead.`,
      },
      { status: 409 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown }
  const reason =
    typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null
  if (!reason) {
    return NextResponse.json(
      {
        error: 'reason required',
        reason: 'Say why this invoice is being withdrawn — it goes in the audit trail.',
      },
      { status: 400 },
    )
  }

  // Invoice carries no voidedAt/voidedBy columns of its own (Payment does).
  // Rather than push DDL at production for this, the who/when/why lives in
  // the AuditLog — the same place the reopen action records itself — and a
  // dated line is appended to the invoice's own notes so anyone reading the
  // row sees it without going to the log.
  const stamp = new Date()
  const voidNote = `[VOIDED ${stamp.toISOString().slice(0, 16).replace('T', ' ')} UTC] ${reason}`
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'VOID',
        // Balance goes to zero: a void invoice is owed by nobody, and
        // leaving it would keep the figure alive in any sum that reads
        // balanceDue without also filtering on status.
        balanceDue: 0,
        notes: invoice.notes ? `${invoice.notes}\n${voidNote}` : voidNote,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: 'invoice.voided',
        entityType: 'Invoice',
        entityId: invoice.id,
        oldValues: {
          status: invoice.status,
          total: Number(invoice.total),
          sentAt: invoice.sentAt?.toISOString() ?? null,
        },
        newValues: {
          status: 'VOID',
          reason,
          invoiceNumber: invoice.invoiceNumber,
          orderNumber: invoice.order.orderNumber,
        },
      },
    })
  })

  return NextResponse.json({
    ok: true,
    invoiceNumber: invoice.invoiceNumber,
    status: 'VOID',
    // The client may already hold the voided document — the UI says so.
    wasSent: !!invoice.sentAt,
    orderId: invoice.order.id,
  })
}
