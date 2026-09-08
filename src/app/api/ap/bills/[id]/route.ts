import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApUser } from '@/lib/ap/access'
import { rematchBill } from '@/lib/ap/scan'
import { ApReviewState } from '@prisma/client'

/**
 * PATCH /api/ap/bills/[id] — the reader's own marks, and a re-check.
 *
 * Body:
 *   { reviewState, reviewNote }  record what Wes made of the row
 *   { rematch: true }            re-run the PO cross-check only
 *
 * The re-check is deliberately separate from the scan: it costs no model
 * call and no Gmail fetch, and it is the half that goes stale. When someone
 * finally records the PO number on a sub-rental, this is what stops the row
 * saying PO_NOT_FOUND.
 *
 * This route can mark a row NOT_A_BILL. It cannot delete one — the row is
 * what keeps the scanner from paying to read the same email again, and a
 * "misread" that quietly reappears next scan is worse than a visible one.
 */

export const dynamic = 'force-dynamic'

const STATES = new Set<string>(Object.values(ApReviewState))

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireApUser()
  if (user instanceof NextResponse) return user

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const existing = await prisma.apBill.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (body.rematch === true) {
    const out = await rematchBill(params.id)
    return NextResponse.json(out)
  }

  const data: {
    reviewState?: ApReviewState
    reviewNote?: string | null
    reviewedAt?: Date
    reviewedById?: string
  } = {}

  if (typeof body.reviewState === 'string') {
    if (!STATES.has(body.reviewState)) {
      return NextResponse.json({ error: `unknown reviewState: ${body.reviewState}` }, { status: 400 })
    }
    data.reviewState = body.reviewState as ApReviewState
  }
  if (typeof body.reviewNote === 'string') {
    data.reviewNote = body.reviewNote.trim().slice(0, 4000) || null
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to change' }, { status: 400 })
  }

  data.reviewedAt = new Date()
  data.reviewedById = user.id

  const updated = await prisma.apBill.update({ where: { id: params.id }, data })
  return NextResponse.json({
    ok: true,
    reviewState: updated.reviewState,
    reviewNote: updated.reviewNote,
    reviewedAt: updated.reviewedAt,
  })
}
