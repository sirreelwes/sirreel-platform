/**
 * POST /api/public/vendor/[token]/hold — the partner's own word on the hold.
 *
 *   { action: 'confirm' }               REQUESTED → CONFIRMED, vendorConfirmedAt stamped
 *   { action: 'decline', note?: string } status UNCHANGED, vendorDeclinedAt + note stamped
 *
 * Until now the hold-request email said "reply to confirm" and a human read
 * the reply. The page is the vendor's surface, so the answer belongs on it.
 * Declining does not cancel anything: a sub-rental that suddenly reads
 * CANCELLED because a partner clicked a button, with a client committed on
 * the other side, is worse than a loud alarm and a human deciding.
 *
 * Token-gated like everything on the vendor page; there is no vendor login.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyVendorWord } from '@/lib/sub-rentals/conduit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token
  if (!token || token.length < 32) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const sub = await prisma.subRental.findFirst({
    where: { vendorToken: token },
    select: { id: true, status: true, vendorConfirmedAt: true },
  })
  if (!sub) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = body.action === 'confirm' || body.action === 'decline' ? body.action : null
  if (!action) return NextResponse.json({ error: 'action must be confirm or decline' }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null

  if (action === 'confirm') {
    if (sub.status === 'CANCELLED' || sub.status === 'RETURNED') {
      return NextResponse.json({ error: 'This booking is closed.' }, { status: 409 })
    }
    if (sub.status === 'ESTIMATED') {
      return NextResponse.json({ error: 'Nothing to confirm yet — the production hasn’t accepted.' }, { status: 409 })
    }
    const already = !!sub.vendorConfirmedAt
    const now = new Date()
    await prisma.subRental.update({
      where: { id: sub.id },
      data: {
        status: sub.status === 'REQUESTED' ? 'CONFIRMED' : sub.status,
        vendorConfirmedAt: sub.vendorConfirmedAt ?? now,
        vendorDeclinedAt: null,
        vendorDeclineNote: null,
      },
    })
    if (!already) {
      await prisma.auditLog.create({
        data: {
          action: 'sub_rental.vendor_confirmed',
          entityType: 'SubRental',
          entityId: sub.id,
          newValues: { from: sub.status, via: 'vendor-page' },
        },
      })
      await notifyVendorWord(sub.id, 'confirmed', null).catch((err) =>
        console.warn('[vendor/hold] notify failed:', err instanceof Error ? err.message : err),
      )
    }
    return NextResponse.json({ ok: true, status: sub.status === 'REQUESTED' ? 'CONFIRMED' : sub.status, confirmedAt: (sub.vendorConfirmedAt ?? now).toISOString() })
  }

  // decline
  if (sub.status === 'CANCELLED' || sub.status === 'RETURNED') {
    return NextResponse.json({ error: 'This booking is closed.' }, { status: 409 })
  }
  const now = new Date()
  await prisma.subRental.update({
    where: { id: sub.id },
    data: { vendorDeclinedAt: now, vendorDeclineNote: note },
  })
  await prisma.auditLog.create({
    data: {
      action: 'sub_rental.vendor_declined',
      entityType: 'SubRental',
      entityId: sub.id,
      newValues: { status: sub.status, note, via: 'vendor-page' },
    },
  })
  await notifyVendorWord(sub.id, 'declined', note).catch((err) =>
    console.warn('[vendor/hold] notify failed:', err instanceof Error ? err.message : err),
  )
  return NextResponse.json({ ok: true, declinedAt: now.toISOString() })
}
