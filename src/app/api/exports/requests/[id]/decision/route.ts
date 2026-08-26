/**
 * POST /api/exports/requests/[id]/decision — approve or deny.
 *
 * The single control point behind Wes's rule. Guarded by
 * requireExportApprover(), which identifies him by EMAIL, not by role:
 * `role === 'ADMIN'` would also admit Dani. See src/lib/exports/approver.ts.
 *
 * Only PENDING rows are decidable — a decision is not re-openable, so an
 * approval cannot be quietly re-granted after its window expires. The
 * requester asks again instead, and that new ask is its own audit row.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireExportApprover } from '@/lib/exports/requireExportApprover'
import { EXPORT_APPROVAL_TTL_HOURS } from '@/lib/exports/approver'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireExportApprover()
  if (!guard.ok) return guard.response
  const { user } = guard

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const decision = body.decision
  if (decision !== 'APPROVE' && decision !== 'DENY') {
    return NextResponse.json(
      { error: 'decision must be APPROVE or DENY' },
      { status: 400 },
    )
  }
  const note =
    typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : null

  const existing = await prisma.dataExportRequest.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (existing.status !== 'PENDING') {
    return NextResponse.json(
      { error: `Request is already ${existing.status}.` },
      { status: 409 },
    )
  }

  const now = new Date()
  const updated = await prisma.dataExportRequest.update({
    // Re-assert PENDING in the WHERE so two concurrent decisions can't both
    // land — the loser updates zero rows and throws P2025.
    where: { id: params.id, status: 'PENDING' },
    data: {
      status: decision === 'APPROVE' ? 'APPROVED' : 'DENIED',
      decidedById: user.id,
      decidedAt: now,
      decisionNote: note,
      expiresAt:
        decision === 'APPROVE'
          ? new Date(now.getTime() + EXPORT_APPROVAL_TTL_HOURS * 3_600_000)
          : null,
    },
    select: {
      id: true,
      status: true,
      decidedAt: true,
      expiresAt: true,
      decisionNote: true,
      decidedBy: { select: { name: true, email: true } },
    },
  })

  return NextResponse.json({ request: updated })
}
