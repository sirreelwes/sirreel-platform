import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { sendPreInvoice } from '@/lib/invoices/sendPreInvoice'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/orders/[id]/pre-invoice — send the client the pre-invoice
 * for review (Wes 2026-09-01).
 *
 * Operates on the order's live DRAFT RENTAL invoice: generate it first
 * (POST /api/orders/[id]/invoices), then send this. Kept separate from
 * generation on purpose — an agent may regenerate a draft several times
 * while correcting it, and each regeneration is not a thing to mail a
 * client about.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true, salesOnly: true },
  })
  if (!actor || !can(actor.role, 'billing')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'Sending a pre-invoice is a billing action.' },
      { status: 403 },
    )
  }

  const draft = await prisma.invoice.findFirst({
    where: { orderId: params.id, type: 'RENTAL', status: 'DRAFT' },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!draft) {
    return NextResponse.json(
      {
        error: 'no draft invoice',
        reason: 'Generate the invoice first — the pre-invoice is that draft, shown to the client for review.',
      },
      { status: 409 },
    )
  }

  const result = await sendPreInvoice({ invoiceId: draft.id, senderEmail: session.user.email })
  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
