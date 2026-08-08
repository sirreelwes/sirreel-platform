import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/collections/rw-invoices?q= — search the RentalWorks invoice mirror
 * so an operator picks a real invoice instead of typing a number from memory.
 *
 * Defaults to invoices with money still owed, newest first — that is what a
 * collections call is about. An explicit query searches all of them, since
 * chasing a specific invoice by number should find it even if RW already
 * shows it settled.
 *
 * Each result carries any charges already taken against it. Without that, two
 * people working the same list can double-charge a client, and the mirror
 * itself won't show a payment taken here until RW syncs.
 */

export async function GET(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 80)

  const where = q
    ? {
        OR: [
          { invoiceNumber: { contains: q, mode: 'insensitive' as const } },
          { customerName: { contains: q, mode: 'insensitive' as const } },
          { orderNumber: { contains: q, mode: 'insensitive' as const } },
          { dealName: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : { remainingTotal: { gt: 0 } }

  const invoices = await prisma.rwInvoice.findMany({
    where,
    orderBy: [{ invoiceDate: 'desc' }],
    take: 50,
    select: {
      rwInvoiceId: true,
      invoiceNumber: true,
      customerName: true,
      dealName: true,
      orderNumber: true,
      invoiceDate: true,
      dueDate: true,
      status: true,
      invoiceTotal: true,
      receivedTotal: true,
      remainingTotal: true,
    },
  })

  // Charges taken in HQ against these invoices. Keyed by the RW id string
  // because the mirror is dropped and rebuilt on every sync.
  const ids = invoices.map((i) => i.rwInvoiceId)
  const priorCharges = ids.length
    ? await prisma.rwCollectionCharge.findMany({
        where: { rwInvoiceId: { in: ids }, status: 'APPROVED' },
        select: { rwInvoiceId: true, amount: true, chargedAt: true },
      })
    : []

  const byInvoice = new Map<string, { count: number; total: number; last: Date | null }>()
  for (const c of priorCharges) {
    const cur = byInvoice.get(c.rwInvoiceId) ?? { count: 0, total: 0, last: null }
    cur.count += 1
    cur.total += Number(c.amount)
    if (!cur.last || c.chargedAt > cur.last) cur.last = c.chargedAt
    byInvoice.set(c.rwInvoiceId, cur)
  }

  return NextResponse.json({
    ok: true,
    invoices: invoices.map((i) => ({
      ...i,
      invoiceTotal: Number(i.invoiceTotal),
      receivedTotal: Number(i.receivedTotal),
      remainingTotal: Number(i.remainingTotal),
      alreadyCharged: byInvoice.get(i.rwInvoiceId) ?? { count: 0, total: 0, last: null },
    })),
  })
}
