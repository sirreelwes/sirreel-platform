import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/rw-invoices/insurance-flag — mark or unmark an RW
 * invoice as waiting on an insurance carrier rather than the client.
 *
 *   { rwInvoiceId, on: boolean, claimNumber?, note? }
 *
 * Any collections user may set or clear it — it is a routing annotation, not
 * a financial decision; being wrong costs a mislabeled chase, not money.
 */
export async function POST(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as {
    rwInvoiceId?: unknown
    on?: unknown
    claimNumber?: unknown
    note?: unknown
  }
  const rwInvoiceId = typeof body.rwInvoiceId === 'string' ? body.rwInvoiceId.trim() : ''
  if (!rwInvoiceId) return NextResponse.json({ ok: false, error: 'rwInvoiceId required' }, { status: 400 })

  if (body.on === false) {
    await prisma.rwInvoiceInsuranceFlag.deleteMany({ where: { rwInvoiceId } })
    return NextResponse.json({ ok: true, flagged: false })
  }

  const claimNumber =
    typeof body.claimNumber === 'string' && body.claimNumber.trim()
      ? body.claimNumber.trim().slice(0, 60)
      : null
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null

  await prisma.rwInvoiceInsuranceFlag.upsert({
    where: { rwInvoiceId },
    create: { rwInvoiceId, claimNumber, note, flaggedById: user.id },
    update: { claimNumber, note, flaggedById: user.id, flaggedAt: new Date() },
  })
  return NextResponse.json({ ok: true, flagged: true })
}
