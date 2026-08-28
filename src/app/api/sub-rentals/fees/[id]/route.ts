/**
 * /api/sub-rentals/fees/[id]
 *
 *   PATCH  → edit any fee field
 *   DELETE → hard delete. Unlike a vehicle (which retires so history
 *            survives), a fee row carries no history of its own — a
 *            wrong rate typed in should vanish, not linger struck
 *            through on every quote screen. Use isActive via PATCH to
 *            park one temporarily.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma, FeeUnit, SubFeeUnionScope } from '@prisma/client'
import { parseMoney } from '@/lib/pricing/resolveRate'
import { requireSubVehicleAccess } from '@/lib/sub-rentals/auth'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const data: Prisma.SubcontractedFeeUpdateInput = {}
  if (typeof body.label === 'string' && body.label.trim()) data.label = body.label.trim()
  if ('amount' in body) {
    const amount = parseMoney(body.amount)
    if (amount == null) return NextResponse.json({ error: 'amount must be numeric' }, { status: 400 })
    data.amount = amount
  }
  if (typeof body.unit === 'string' && Object.values(FeeUnit).includes(body.unit as FeeUnit)) {
    data.unit = body.unit as FeeUnit
  }
  if ('coversHours' in body) data.coversHours = parseMoney(body.coversHours)
  if (typeof body.unionScope === 'string' && Object.values(SubFeeUnionScope).includes(body.unionScope as SubFeeUnionScope)) {
    data.unionScope = body.unionScope as SubFeeUnionScope
  }
  if (typeof body.discountApplies === 'boolean') data.discountApplies = body.discountApplies
  if ('notes' in body) data.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (Number.isInteger(body.sortOrder)) data.sortOrder = body.sortOrder as number

  try {
    const fee = await prisma.subcontractedFee.update({ where: { id: params.id }, data })
    return NextResponse.json({ fee })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  try {
    await prisma.subcontractedFee.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    throw e
  }
}
