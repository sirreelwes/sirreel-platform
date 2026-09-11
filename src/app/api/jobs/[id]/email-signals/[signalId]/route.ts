import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; signalId: string }> }

/**
 * POST /api/jobs/[id]/email-signals/[signalId]
 *   { action: 'confirm' | 'dismiss', note?: string }
 *
 * Resolves a change-of-plan suggestion. This route changes the SUGGESTION
 * only — it never touches the job, its orders, its holds or its bookings.
 * "confirm" means "yes, the client meant it, and I have made (or am
 * making) the change through the normal controls": Mark lost, the status
 * menu, the order's dates. Keeping the two apart is the whole point (Wes
 * 2026-09-11): the row records that a human read the email and decided;
 * the change itself goes through the same audited path it always did.
 *
 * Write-once: a resolved row stays resolved (the card shows who and when).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id || null
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { id, signalId } = await params
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; note?: unknown }
  const action = body.action === 'confirm' || body.action === 'dismiss' ? body.action : null
  if (!action) return NextResponse.json({ error: "action must be 'confirm' or 'dismiss'" }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null

  const signal = await prisma.jobEmailSignal
    .findFirst({ where: { id: signalId, jobId: id }, select: { id: true, status: true, kind: true } })
    .catch(() => null)
  if (!signal) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (signal.status !== 'OPEN') {
    return NextResponse.json({ error: `already ${signal.status.toLowerCase()}` }, { status: 409 })
  }

  const status = action === 'confirm' ? 'CONFIRMED' : 'DISMISSED'
  const updated = await prisma.jobEmailSignal.update({
    where: { id: signal.id },
    data: { status, resolvedById: userId, resolvedAt: new Date(), resolutionNote: note },
    select: { id: true, status: true, resolvedAt: true },
  })

  await prisma.auditLog
    .create({
      data: {
        userId,
        action: action === 'confirm' ? 'job.email_signal_confirmed' : 'job.email_signal_dismissed',
        entityType: 'job',
        entityId: id,
      },
    })
    .catch(() => undefined)

  return NextResponse.json(updated)
}
