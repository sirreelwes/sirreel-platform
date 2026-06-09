/**
 * PATCH  /api/claims/[id]/documents/[docId]
 *   Body: { type: ClaimDocType }
 *   Updates the document's type. Always stamps typeSource = USER and
 *   nulls typeConfidence — the moment a human touches the chip we
 *   consider it confirmed, and the AI's old confidence number is
 *   misleading once the type can no longer have been "suggested".
 *
 * DELETE /api/claims/[id]/documents/[docId]
 *   Removes the row. Blob cleanup is best-effort; failures don't block
 *   the DB delete.
 *
 * Both auth-guarded.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { del } from '@vercel/blob'
import type { ClaimDocType } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Mirror the full enum here so the API rejects an unknown value
// without needing to import the Prisma enum runtime in the validator.
const VALID_TYPES: ClaimDocType[] = [
  'CHECKOUT_PHOTO', 'RETURN_PHOTO',
  'REPAIR_ESTIMATE', 'REPAIR_INVOICE',
  'DEMAND_LETTER', 'COUNTER_LETTER',
  'COI', 'RENTAL_AGREEMENT',
  'CORRESPONDENCE', 'SETTLEMENT',
  'PHOTO', 'DAMAGE_INVOICE', 'POLICE_REPORT', 'OTHER',
]
const VALID_SET = new Set<string>(VALID_TYPES)

type Params = { params: Promise<{ id: string; docId: string }> }

async function requireUser() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const me = await requireUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: claimId, docId } = await params
  const body = (await req.json().catch(() => ({}))) as { type?: unknown }
  if (typeof body.type !== 'string' || !VALID_SET.has(body.type)) {
    return NextResponse.json(
      { error: 'type must be a valid ClaimDocType' },
      { status: 400 },
    )
  }

  const existing = await prisma.claimDocument.findFirst({
    where: { id: docId, claimId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const updated = await prisma.claimDocument.update({
    where: { id: docId },
    data: {
      type: body.type as ClaimDocType,
      typeSource: 'USER',
      typeConfidence: null,
    },
    select: {
      id: true, type: true, typeSource: true, typeConfidence: true,
      title: true, fileUrl: true, notes: true,
    },
  })
  return NextResponse.json({ ok: true, document: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const me = await requireUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: claimId, docId } = await params
  const existing = await prisma.claimDocument.findFirst({
    where: { id: docId, claimId },
    select: { id: true, fileUrl: true },
  })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.claimDocument.delete({ where: { id: docId } })
  // Best-effort blob cleanup. The row is already gone; a stranded
  // blob is wasted storage, not a correctness issue.
  if (existing.fileUrl) {
    void del(existing.fileUrl).catch((err) =>
      console.warn('[DELETE /claims/documents] blob delete failed:', err instanceof Error ? err.message : err),
    )
  }
  return NextResponse.json({ ok: true })
}
