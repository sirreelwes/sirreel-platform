/**
 * POST /api/inquiries/[id]/mark-handled — close a payment-info request that
 * was dealt with outside the app.
 *
 * The only way to clear one of these was to SEND payment details from the
 * panel. If Ana verified the requester and handled it by phone, or the
 * details had already gone out, the inquiry sat in the queue looking
 * outstanding forever.
 *
 * Why a dedicated route rather than PATCH { status: 'CONVERTED' }: the
 * generic PATCH writes no audit entry and no metadata, so a closed inquiry
 * carries no record of who closed it or why. One in the queue right now is
 * CONVERTED with nothing sent and no trace of what did it — which is exactly
 * the ambiguity this avoids.
 *
 * CONVERTED is the terminal "handled" state the send path already uses.
 * `handledManually` in sourceMetadata is what distinguishes the two, so the
 * UI can say "marked handled by Ana" rather than implying an email went out.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, sourceMetadata: true },
  })
  if (!inquiry) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { note?: unknown }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''

  const prior =
    inquiry.sourceMetadata && typeof inquiry.sourceMetadata === 'object' && !Array.isArray(inquiry.sourceMetadata)
      ? (inquiry.sourceMetadata as Record<string, unknown>)
      : {}

  const handledAt = new Date().toISOString()
  await prisma.inquiry.update({
    where: { id: inquiry.id },
    data: {
      status: 'CONVERTED',
      sourceMetadata: {
        ...prior,
        handledManually: true,
        handledAt,
        handledBy: session.user.email,
        ...(note ? { handledNote: note } : {}),
      },
    },
  })

  // Audited, unlike the generic PATCH. A closed request that nobody can
  // account for is how the current confusion started.
  await prisma.auditLog
    .create({
      data: {
        userId: null,
        action: 'inquiry.marked_handled',
        entityType: 'Inquiry',
        entityId: inquiry.id,
        oldValues: { status: inquiry.status },
        newValues: { status: 'CONVERTED', handledBy: session.user.email, handledAt, note: note || null },
      },
    })
    .catch((e) => console.error('[mark-handled] audit write failed:', e))

  return NextResponse.json({ ok: true, handledAt, handledBy: session.user.email })
}
