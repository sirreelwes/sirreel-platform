import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { generateRentalInvoice } from '@/lib/invoices/generateRentalInvoice'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/invoices/[id]/regenerate — rewrite an invoice from the order it
 * bills, keeping its number.
 *
 * Wes 2026-09-01: "because this isn't the official accounting software yet,
 * can we simply replace and keep the inv number?"
 *
 * Void-and-reissue is the textbook instrument, and it stays available — it
 * leaves the withdrawn document on the record and gives the correction its
 * own number, which is what you want once HQ is the book of record. But it
 * hands the client a second number to reconcile, and today the accounting of
 * record is elsewhere. A client holding SR-INV-30001 should get a corrected
 * SR-INV-30001.
 *
 * So: same row, same number, refreshed figures / line snapshot / discount
 * snapshot / PDF. status and sentAt are untouched — a rewrite does not
 * un-send a document that was genuinely sent. What changed is written to the
 * invoice's notes and to an AuditLog row carrying both totals.
 *
 * Refuses when money has been applied. A payment was taken against a stated
 * figure; moving the total underneath it would leave that payment
 * reconciling to a number that exists nowhere. That case wants void + reissue
 * (or a credit), and the error says so.
 *
 * Billing-gated, like voiding and like reopening a closed order.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
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
      { error: 'forbidden', reason: 'Updating an invoice is a billing action.' },
      { status: 403 },
    )
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: { id: true, invoiceNumber: true, type: true, orderId: true, total: true, sentAt: true },
  })
  if (!invoice) return NextResponse.json({ error: 'invoice not found' }, { status: 404 })
  if (invoice.type !== 'RENTAL') {
    return NextResponse.json(
      {
        error: 'not a rental invoice',
        reason: `${invoice.invoiceNumber} is an ${invoice.type} invoice — only the rental invoice is derived from the order.`,
      },
      { status: 409 },
    )
  }

  const before = Number(invoice.total)
  // Every other guard (voided, payments applied, a second live invoice on
  // the order) lives in the generator, so the button and any future caller
  // get the same answers.
  const res = await generateRentalInvoice({
    orderId: invoice.orderId,
    replaceInvoiceId: invoice.id,
  })
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error, reason: res.error }, { status: res.status })
  }

  return NextResponse.json({
    ok: true,
    invoiceNumber: res.invoiceNumber,
    previousTotal: before.toFixed(2),
    total: res.total,
    changed: Math.abs(Number(res.total) - before) >= 0.01,
    // The caller decides how loudly to say "the client has the old figure".
    wasSent: !!invoice.sentAt,
  })
}
