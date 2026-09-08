/**
 * Read a pasted supply list against an EXISTING order.
 *
 * Oliver, 2026-09-08: "when I go to edit an existing order I'd like a
 * button that opens up that AI email parser box, where I can copy and
 * paste this supply list. It would help with big supply orders that come
 * a day after we make their vehicle quote."
 *
 * This runs the SAME pipeline /api/orders/parse-quote runs — the shared
 * one in src/lib/sales/parseQuoteItems.ts — so a list pasted here matches
 * the catalog, bundles radio accessories and expands kit pieces exactly
 * as it would when starting a quote. What it does NOT do is anything the
 * quote path does with clients, contacts or dates: this order already has
 * all three, and letting a pasted note move them is how a supply add-on
 * silently rewrites a booked rental window.
 *
 * It also WRITES NOTHING. It returns candidate lines for the rep to look
 * at; adding them goes through POST /api/orders/[id]/line-items one line
 * at a time, which is where client rate cards, the Lankershim
 * double-billing guard, capacity conflicts and the audit row live. A
 * bulk-insert path here would have to reimplement all of it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AiJsonError } from '@/lib/ai/extractJson'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'
import { parseQuoteText, resolveParsedItems } from '@/lib/sales/parseQuoteItems'

// Same headroom as the quote parser — a long supply list is a long parse.
export const maxDuration = 120

const ymd = (d: Date | null): string | null =>
  // @db.Date is stored at UTC midnight; format in UTC or it prints the
  // previous day west of Greenwich.
  d ? d.toISOString().slice(0, 10) : null

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 500 })
  }

  const { id } = await params
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      // Never read startDate/endDate directly — the column is a mirror
      // that goes stale when a line is edited. deriveOrderWindow reads
      // the lines and the live holds.
      lineItems: { select: { pickupDate: true, returnDate: true } },
      booking: { select: { startDate: true, endDate: true, status: true } },
      job: { select: { bookings: { select: { startDate: true, endDate: true, status: true } } } },
    },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  const window = deriveOrderWindow(order)

  try {
    const parsed = await parseQuoteText(text)
    // The order's own window is the anchor, NOT whatever dates the pasted
    // note happens to mention. A supply list that says "for the shoot on
    // the 22nd" must not quietly re-date an order that is already booked.
    const items = await resolveParsedItems(parsed.items, {
      startDate: ymd(window.start),
      endDate: ymd(window.end),
    })
    return NextResponse.json({
      ok: true,
      items,
      orderNumber: order.orderNumber,
      window: { start: ymd(window.start), end: ymd(window.end) },
      // Surfaced so the modal can say "these dates were ignored" rather
      // than the rep wondering why the parsed dates did not take.
      parsedDates: { start: parsed.startDate ?? null, end: parsed.endDate ?? null },
    })
  } catch (e) {
    if (e instanceof AiJsonError && e.truncated) {
      return NextResponse.json(
        { error: 'That list is too long to read in one go — paste it in a couple of chunks.' },
        { status: 422 },
      )
    }
    console.error('[parse-lines] failed:', e)
    return NextResponse.json(
      { error: "Couldn't read that list — try again, or add the lines by hand." },
      { status: 500 },
    )
  }
}
