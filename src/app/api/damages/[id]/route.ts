/**
 * PATCH /api/damages/[id]  — update a damage item's disposition.
 *
 * Phase 5 commit 4 — operator triage edit. Body { disposition }.
 * Returns 409 if the damage is already attached to an invoice (can't
 * retriage what's billed; void the invoice first).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { DamageDisposition } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { setDamageDisposition } from '@/lib/inspections/captureReturnDamage'

export const dynamic = 'force-dynamic'

const DISPOSITIONS: DamageDisposition[] = ['PENDING', 'BILL_NOW', 'SEND_TO_LD', 'WAIVED']

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { disposition?: unknown }
  const disposition =
    typeof body.disposition === 'string' && DISPOSITIONS.includes(body.disposition as DamageDisposition)
      ? (body.disposition as DamageDisposition)
      : null
  if (!disposition) {
    return NextResponse.json(
      { error: `disposition required (one of ${DISPOSITIONS.join(', ')})` },
      { status: 400 },
    )
  }

  const result = await setDamageDisposition({
    damageId: params.id,
    disposition,
    userId: user.id,
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
