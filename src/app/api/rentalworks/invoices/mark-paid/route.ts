import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * HQ-side "paid" override for an RW invoice, for when RW lags reality.
 * RW's status stays authoritative; this just clears an invoice from HQ AR
 * once it's actually collected. Keyed on rwInvoiceId so it survives the
 * mirror resync. Reversible.
 *
 * POST   { rwInvoiceId, note? } → mark paid
 * DELETE ?rwInvoiceId=…         → un-mark
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { rwInvoiceId?: unknown; note?: unknown }
  const rwInvoiceId = String(body.rwInvoiceId ?? '').trim()
  if (!rwInvoiceId) return NextResponse.json({ error: 'rwInvoiceId required' }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  await prisma.rwInvoicePaidMark.upsert({
    where: { rwInvoiceId },
    create: { rwInvoiceId, note, markedById: user?.id ?? null },
    update: { note },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rwInvoiceId = req.nextUrl.searchParams.get('rwInvoiceId')?.trim()
  if (!rwInvoiceId) return NextResponse.json({ error: 'rwInvoiceId required' }, { status: 400 })
  await prisma.rwInvoicePaidMark.deleteMany({ where: { rwInvoiceId } })
  return NextResponse.json({ ok: true })
}
