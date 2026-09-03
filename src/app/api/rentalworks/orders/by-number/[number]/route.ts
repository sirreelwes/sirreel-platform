import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { lookupRwOrderByNumber } from '@/lib/rentalworks/orderRef'
import { prisma } from '@/lib/prisma'
import { readRwToken } from '@/lib/rentalworks/credential'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rentalworks/orders/by-number/[number]
 *
 * Staff view of ONE RentalWorks order, addressed by its human-facing
 * order number. Resolves number → internal OrderId via the RwOrderRef
 * mirror (lazy full-scan on miss — see src/lib/rentalworks/orderRef.ts),
 * then fetches the live order header from RW.
 *
 * Line items are deliberately absent: RW's orderitem browse rejects
 * every server-side filter shape, and the order GET carries no item
 * array — the header (customer, deal, dates, status, total) is what we
 * can serve truthfully. The gantt's "RW #…" link lands here (it used
 * to dump users on the jobs list — Wes, 2026-08-22).
 */
export async function GET(_req: NextRequest, { params }: { params: { number: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const number = params.number?.trim()
  if (!number || !/^\d{3,10}$/.test(number)) {
    return NextResponse.json({ error: 'invalid order number' }, { status: 400 })
  }

  // Mirror-only: fast and indexed. A full RW rescan takes ~5 minutes
  // (their paging), so it never blocks this request — on a miss we kick
  // one off in the background and tell the user plainly.
  const ref = await lookupRwOrderByNumber(number)
  if (!ref) {
    // The number may be a QUOTE, not an order — RW keeps them as separate
    // entities and the Planyo notes these numbers come from carry either
    // kind (Retrofit's 304502 is a quote; verified 2026-08-22). The quote
    // mirror is already synced, so serve it rather than 404-ing on a
    // number the user can plainly see on a PDF.
    const quote = await prisma.rwQuote.findFirst({
      where: { OR: [{ quoteNumber: number }, { orderNumber: number }] },
    })
    if (quote) {
      return NextResponse.json({
        ok: true,
        orderNumber: number,
        rwOrderId: quote.rwQuoteId,
        kind: 'quote',
        source: 'mirror',
        order: {
          description: quote.description,
          customer: quote.customerName,
          deal: quote.dealName,
          status: quote.status,
          total: quote.total != null ? Number(quote.total) : null,
          orderDate: quote.quoteDate,
          estimatedStartDate: quote.startDate,
          estimatedEndDate: quote.endDate,
          officeLocation: null,
          warehouse: null,
          agent: quote.agent,
        },
      })
    }
    // This used to fire warmRwOrderRefsInBackground() and tell the user
    // "the index is refreshing now". Neither half was true: Vercel freezes
    // the function once this response is sent, so the ~294s scan died
    // immediately, every time. Report what IS true — when the index last
    // refreshed — instead of promising a refresh that never happened.
    const freshest = await prisma.rwOrderRef.aggregate({ _max: { syncedAt: true } })
    const lastIndexed = freshest._max.syncedAt
    return NextResponse.json(
      {
        error:
          `#${number} isn't in HQ's RentalWorks index` +
          (lastIndexed
            ? `, which last refreshed ${lastIndexed.toISOString().slice(0, 16).replace('T', ' ')} UTC. It refreshes on a schedule; if this order was created after that, it will appear on the next run.`
            : `. The index has never been built — check the RentalWorks card on Collections.`),
        lastIndexedAt: lastIndexed,
      },
      { status: 404 },
    )
  }

  // Live header — the mirror copy is the fallback when RW is down.
  let live: Record<string, unknown> | null = null
  try {
    // Stored credential, but not rwFetch: same per-record-GET caveat as the
    // invoice PDF route. RW rejects single-record reads for a bearer its
    // browse endpoints accept, and this call already degrades to the mirror.
    // Letting that stamp the credential EXPIRED would redden the meter on a
    // healthy token.
    const res = await fetch(`https://sirreel.rentalworks.cloud/api/v1/order/${ref.rwOrderId}`, {
      headers: { Authorization: `Bearer ${(await readRwToken()) ?? ''}`, Accept: 'application/json' },
    })
    if (res.ok) live = (await res.json()) as Record<string, unknown>
  } catch {
    // RW unreachable — serve the mirror header below.
  }

  const pick = (k: string) => (live?.[k] as string | number | null | undefined) ?? null
  return NextResponse.json({
    ok: true,
    orderNumber: ref.orderNumber,
    rwOrderId: ref.rwOrderId,
    kind: 'order',
    source: live ? 'live' : 'mirror',
    order: {
      description: pick('Description') ?? ref.description,
      customer: pick('Customer') ?? ref.customerName,
      deal: pick('DealName') ?? pick('Deal') ?? ref.dealName,
      status: pick('Status') ?? ref.status,
      total: pick('Total') ?? (ref.total != null ? Number(ref.total) : null),
      orderDate: ref.orderDate,
      estimatedStartDate: pick('EstimatedStartDate'),
      estimatedEndDate: pick('EstimatedEndDate'),
      officeLocation: pick('OfficeLocation'),
      warehouse: pick('Warehouse'),
      agent: pick('Agent'),
    },
  })
}
