import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { RW_VOID, isOpen } from '@/lib/rentalworks/arStatus'

export const dynamic = 'force-dynamic'

/**
 * GET /api/crm/companies/[id]/rw-ar — this client's RentalWorks AR, read
 * from the HQ mirror (never live RW, so a token expiry shows as STALE
 * rather than a silent $0).
 *
 * Joined on Company.rentalworksCustomerId -> RwInvoice.rwCustomerId, the
 * only linkage that is actually populated (97% of companies). Job-level
 * joining is impossible today: Booking.rentalworksOrderId is unpopulated.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { rentalworksCustomerId: true },
  })
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  if (!company.rentalworksCustomerId) {
    return NextResponse.json({ linked: false, invoices: [], syncedAt: null })
  }

  const invoices = await prisma.rwInvoice.findMany({
    where: { rwCustomerId: company.rentalworksCustomerId, status: { not: RW_VOID } },
    orderBy: [{ invoiceDate: 'desc' }],
    take: 200,
    select: {
      id: true, invoiceNumber: true, invoiceType: true, status: true,
      invoiceDate: true, dueDate: true, orderNumber: true, poNumber: true,
      invoiceTotal: true, receivedTotal: true, remainingTotal: true, syncedAt: true,
    },
  })

  const n = (d: unknown) => Number(d ?? 0)
  const open = invoices.filter((i) => isOpen({ remainingTotal: n(i.remainingTotal), status: i.status }))
  const now = Date.now()
  const overdue = open.filter((i) => i.dueDate && new Date(i.dueDate).getTime() < now)

  return NextResponse.json({
    linked: true,
    syncedAt: invoices[0]?.syncedAt ?? null,
    totals: {
      invoiced: invoices.reduce((s, i) => s + n(i.invoiceTotal), 0),
      received: invoices.reduce((s, i) => s + n(i.receivedTotal), 0),
      outstanding: open.reduce((s, i) => s + n(i.remainingTotal), 0),
      openCount: open.length,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((s, i) => s + n(i.remainingTotal), 0),
    },
    invoices: invoices.map((i) => ({
      ...i,
      invoiceTotal: n(i.invoiceTotal),
      receivedTotal: n(i.receivedTotal),
      remainingTotal: n(i.remainingTotal),
    })),
  })
}
