/**
 * /api/orders/[id]/send-to-warehouse — the pull-order handoff.
 *
 * GET  → what the confirm dialog shows: line count, pickup window,
 *        readiness blockers, recipient count, and whether it has been
 *        sent before. Never mutates.
 * POST → releases the PickList to the picking floor and emails the
 *        'pickup-picklists' channel. Body: { note?: string }.
 *
 * SALES-side auth, not requirePickerRole: this is the rep pushing work
 * TO the warehouse (see /guides/sending-orders), so any active signed-in
 * user may send. The warehouse guard belongs on the floor's own
 * endpoints, and putting it here would mean the person who built the
 * order is the one person who cannot hand it over.
 *
 * All the reasoning about what a release means lives in
 * lib/warehouse/sendPullOrder.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { previewPullOrder, sendPullOrderToWarehouse } from '@/lib/warehouse/sendPullOrder'

export const dynamic = 'force-dynamic'
// POST renders the pull-sheet PDF to attach it — the same budget the
// other Puppeteer/react-pdf routes carry, not the default.
export const maxDuration = 60

async function requireUser() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, isActive: true },
  })
  if (!user || !user.isActive) return null
  return user
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const pre = await previewPullOrder(params.id)
  if (!pre.ok) return NextResponse.json({ error: pre.error }, { status: pre.status })
  return NextResponse.json({ preview: pre.preview })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // A malformed/absent body is a note-less send, not a 400 — the note
  // is optional and the button may post nothing at all.
  let note: string | null = null
  try {
    const body = await req.json()
    if (typeof body?.note === 'string') note = body.note
  } catch {
    /* no body */
  }

  const res = await sendPullOrderToWarehouse({
    orderId: params.id,
    userId: user.id,
    userName: user.name,
    note,
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json(res.result)
}
