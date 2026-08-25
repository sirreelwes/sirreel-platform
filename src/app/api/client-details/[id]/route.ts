import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/client-details/[id] — an agent resolves a client's suggested
 * company / project name.
 *
 *   { action: 'applied' }   — the agent used it (they applied the values
 *                             through CompanyPicker / JobResolver, which
 *                             is where near-match and find-or-create
 *                             discipline lives). This route records the
 *                             decision; it does NOT write the company or
 *                             job itself, precisely so there is only one
 *                             path that can create those rows.
 *   { action: 'dismissed' } — wrong person answered, junk, or superseded.
 *
 * Gated on canCreateBooking (AGENT + ADMIN) — same bar as the rest of the
 * sales surface. No ownership check: matching the status/dates/info
 * routes, clearing the queue is shared coverage work.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params

  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!actor || !can(actor.role, 'canCreateBooking')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'resolving a client reply is a sales action' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => null)) as { action?: string } | null
  const action = body?.action
  if (action !== 'applied' && action !== 'dismissed') {
    return NextResponse.json({ error: "action must be 'applied' or 'dismissed'" }, { status: 400 })
  }

  const existing = await prisma.clientDetailReply.findUnique({
    where: { id },
    select: { id: true, status: true },
  })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (existing.status !== 'PENDING') {
    // Two agents on the queue at once — first decision stands, and saying
    // so beats silently overwriting theirs.
    return NextResponse.json(
      { ok: false, error: `already ${existing.status.toLowerCase()} by someone else` },
      { status: 409 },
    )
  }

  await prisma.clientDetailReply.update({
    where: { id },
    data: {
      status: action === 'applied' ? 'APPLIED' : 'DISMISSED',
      resolvedById: actor.id,
      resolvedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true })
}
