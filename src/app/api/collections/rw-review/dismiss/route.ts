import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

/**
 * POST /api/collections/rw-review/dismiss — set an invoice aside on the review
 * desk. DELETE ?rwInvoiceId=… puts it back.
 *
 * Wes, 2026-09-02: "Can i have an option to just mark them paid or dismiss
 * them in the aging RW invoices page?"
 *
 * Dismiss is the deliberately weak one, and the distinction is the whole point:
 *
 *   Mark paid   asserts the money arrived. Leaves Outstanding, leaves the
 *               aging review, changes the AR figure people quote.
 *   Write off   says we are never getting it. Lands in the bad-debt ledger at
 *               tax time. Wes only.
 *   Dismiss     says "I have read this and there is nothing to do today."
 *               The balance stays owed, stays in Outstanding, stays on the
 *               aging review. It only stops occupying the reading room.
 *
 * A desk whose only exits are "paid" and "written off" is a desk that will be
 * used to claim things that did not happen, because people need SOME way to
 * clear a row they have finished with.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const rwInvoiceId = typeof body.rwInvoiceId === 'string' ? body.rwInvoiceId : ''
  if (!rwInvoiceId) return NextResponse.json({ error: 'rwInvoiceId required' }, { status: 400 })
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) || null : null

  const stamp = { dismissedAt: new Date(), dismissedBy: user.email, dismissedReason: reason }
  await prisma.rwInvoiceReview.upsert({
    where: { rwInvoiceId },
    create: { rwInvoiceId, ...stamp },
    update: stamp,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const rwInvoiceId = req.nextUrl.searchParams.get('rwInvoiceId')?.trim()
  if (!rwInvoiceId) return NextResponse.json({ error: 'rwInvoiceId required' }, { status: 400 })

  // updateMany, not update: bringing back a row that was never dismissed is a
  // no-op rather than a 404.
  await prisma.rwInvoiceReview.updateMany({
    where: { rwInvoiceId },
    data: { dismissedAt: null, dismissedBy: null, dismissedReason: null },
  })
  return NextResponse.json({ ok: true })
}
