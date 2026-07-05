import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { parseMoney } from '@/lib/pricing/resolveRate'
import type { FeeUnit, Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const UNITS: FeeUnit[] = ['FLAT', 'PER_DAY', 'PER_HOUR', 'PER_MILE', 'PER_GALLON', 'PERCENT']

type Params = { params: Promise<{ id: string }> }

// PATCH — edit name / code / amount / unit / description / isActive.
// Existing order lines keep their written rate + lineTotal (fees are
// priced at add time, same snapshot semantics as catalog rates).
export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  const body = await req.json().catch(() => ({}))
  const data: Prisma.FeeItemUpdateInput = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    data.name = name
  }
  if (body.code !== undefined) {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    if (!code) return NextResponse.json({ error: 'code cannot be empty' }, { status: 400 })
    const dupe = await prisma.feeItem.findUnique({ where: { code }, select: { id: true } })
    if (dupe && dupe.id !== id) {
      return NextResponse.json({ error: `code "${code}" already exists` }, { status: 409 })
    }
    data.code = code
  }
  if (body.amount !== undefined) {
    const amount = parseMoney(body.amount)
    if (!amount || amount.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
    }
    data.amount = amount
  }
  if (body.unit !== undefined) {
    if (!UNITS.includes(body.unit)) {
      return NextResponse.json({ error: 'invalid unit' }, { status: 400 })
    }
    data.unit = body.unit as FeeUnit
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim() : null
  }
  if (body.isActive !== undefined) {
    data.isActive = !!body.isActive
  }

  try {
    const fee = await prisma.feeItem.update({ where: { id }, data })
    if ((fee.unit as FeeUnit) === 'PERCENT' && fee.amount.greaterThan(100)) {
      // post-hoc sanity: revert an amount/unit combo that landed >100%
      await prisma.feeItem.update({ where: { id }, data: { amount: 100 } })
      return NextResponse.json({ error: 'PERCENT amount clamped to 100' }, { status: 400 })
    }
    return NextResponse.json({ fee: { ...fee, amount: fee.amount.toFixed(2) } })
  } catch {
    return NextResponse.json({ error: 'fee not found' }, { status: 404 })
  }
}

// DELETE — hard delete only when the fee has never been used on an
// order line; otherwise archive (isActive=false), mirroring the
// asset-categories delete guard.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  const fee = await prisma.feeItem.findUnique({
    where: { id },
    select: { id: true, _count: { select: { lineItems: true } } },
  })
  if (!fee) return NextResponse.json({ error: 'fee not found' }, { status: 404 })

  if (fee._count.lineItems > 0) {
    await prisma.feeItem.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({
      archived: true,
      reason: `Fee is referenced by ${fee._count.lineItems} order line(s) — archived instead of deleted.`,
    })
  }
  await prisma.feeItem.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}
