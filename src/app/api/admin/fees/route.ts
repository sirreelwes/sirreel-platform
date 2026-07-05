import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { parseMoney } from '@/lib/pricing/resolveRate'
import type { FeeUnit } from '@prisma/client'

export const dynamic = 'force-dynamic'

const UNITS: FeeUnit[] = ['FLAT', 'PER_DAY', 'PER_MILE', 'PER_GALLON', 'PERCENT']

// GET — admin list of ALL fee items (active + archived) with usage
// counts for the delete guard. Amounts serialize as strings.
export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const rows = await prisma.feeItem.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true, name: true, code: true, amount: true, unit: true,
      description: true, isActive: true, updatedAt: true,
      _count: { select: { lineItems: true } },
    },
  })
  return NextResponse.json({
    fees: rows.map((f) => ({
      id: f.id, name: f.name, code: f.code, amount: f.amount.toFixed(2),
      unit: f.unit, description: f.description, isActive: f.isActive,
      updatedAt: f.updatedAt.toISOString(), lineItemCount: f._count.lineItems,
    })),
  })
}

// POST — create a fee item.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  const amount = parseMoney(body.amount)
  const unit = UNITS.includes(body.unit) ? (body.unit as FeeUnit) : null
  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim() : null

  if (!name || !code || !amount || amount.lessThanOrEqualTo(0) || !unit) {
    return NextResponse.json(
      { error: 'name, code, positive amount, and a valid unit are required' },
      { status: 400 },
    )
  }
  if (unit === 'PERCENT' && amount.greaterThan(100)) {
    return NextResponse.json({ error: 'PERCENT amount must be 0–100' }, { status: 400 })
  }

  const dupe = await prisma.feeItem.findUnique({ where: { code } })
  if (dupe) {
    return NextResponse.json({ error: `code "${code}" already exists` }, { status: 409 })
  }

  const fee = await prisma.feeItem.create({
    data: { name, code, amount, unit, description },
  })
  return NextResponse.json({ fee: { ...fee, amount: fee.amount.toFixed(2) } }, { status: 201 })
}
