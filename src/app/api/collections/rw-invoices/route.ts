import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { collectibleWhere } from '@/lib/collections/collectible'
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

  // Invoices someone has already marked paid in HQ. The mirror still shows a
  // balance on them — RW has not been told, or has not synced back — so
  // without this they sat in the collectible list and Ana would chase money
  // a colleague already recorded as received.
  // WRITE_OFF triage rows leave the collectible list exactly like paid-marks:
  // deemed uncollectible is not collectible. Search still finds them.
  const writtenOff = (
    await prisma.rwInvoiceTriage.findMany({
      where: { decision: 'WRITE_OFF' },
      select: { rwInvoiceId: true },
    })
  ).map((t) => t.rwInvoiceId)
  const insuranceFlags = await prisma.rwInvoiceInsuranceFlag.findMany({
    select: { rwInvoiceId: true, claimNumber: true },
  })
  const insuranceBy = new Map(insuranceFlags.map((f) => [f.rwInvoiceId, f]))
  const paidMarks = await prisma.rwInvoicePaidMark.findMany({
    select: { rwInvoiceId: true, markedAt: true, note: true },
  })
  const paidMarkById = new Map(paidMarks.map((m) => [m.rwInvoiceId, m]))
  const paidMarkedIds = paidMarks.map((m) => m.rwInvoiceId)

  const where = q
    ? {
        OR: [
          { invoiceNumber: { contains: q, mode: 'insensitive' as const } },
          { customerName: { contains: q, mode: 'insensitive' as const } },
          { orderNumber: { contains: q, mode: 'insensitive' as const } },
          { dealName: { contains: q, mode: 'insensitive' as const } },
        ],
      }
      // The default list is "what is collectible", so paid-marked invoices are
      // excluded. An explicit SEARCH still returns them — flagged — because
      // someone looking up a specific number needs to find it, and a mark
      // made in error must stay visible rather than vanishing.
      //
      // VOID is excluded the same way (found 2026-08-18: 1,197 voided
      // invoices carried $2.0M of remainingTotal — RW keeps the balance
      // populated on a void, so "remaining > 0" alone offered Ana cancelled
      // obligations to charge cards against). Search still surfaces them,
      // with the status visible on the row.
    : collectibleWhere([...paidMarkedIds, ...writtenOff])

  const invoices = await prisma.rwInvoice.findMany({
    where,
    // Default list: oldest debt first — this is a worklist, and the invoice
    // most in need of a call belongs at the top (Wes, 2026-08-19). SEARCH
    // keeps newest-first: someone typing a number wants recency, not aging.
    orderBy: q
      ? [{ invoiceDate: 'desc' as const }]
      : [{ dueDate: { sort: 'asc' as const, nulls: 'last' as const } }, { invoiceDate: 'asc' as const }],
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

  // Age of the mirror. A collections list that silently serves two-week-old
  // balances is worse than one that says how old it is — the operator cannot
  // otherwise tell they are quoting a stale number to a client on the phone.
  const freshest = await prisma.rwInvoice.aggregate({ _max: { syncedAt: true } })

  return NextResponse.json({
    ok: true,
    syncedAt: freshest._max.syncedAt ?? null,
    invoices: invoices.map((i) => {
      const mark = paidMarkById.get(i.rwInvoiceId)
      const ins = insuranceBy.get(i.rwInvoiceId)
      return {
        ...i,
        insurance: ins ? { claimNumber: ins.claimNumber } : null,
        invoiceTotal: Number(i.invoiceTotal),
        receivedTotal: Number(i.receivedTotal),
        remainingTotal: Number(i.remainingTotal),
        alreadyCharged: byInvoice.get(i.rwInvoiceId) ?? { count: 0, total: 0, last: null },
        paidMarkedAt: mark?.markedAt ?? null,
        paidMarkNote: mark?.note ?? null,
      }
    }),
  })
}
