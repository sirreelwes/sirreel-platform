/**
 * GET    /api/admin/packages/[id] — single package with items.
 * PUT    /api/admin/packages/[id] — update name / dept / price /
 *   description / active + REPLACE the items list.
 * DELETE /api/admin/packages/[id] — hard delete. Existing OrderLineItem
 *   rows linked via FK get `packageId = null` via onDelete: SetNull
 *   (the packageInstanceId column keeps grouping intact on historical
 *   orders). Soft-deactivate via PUT active: false to hide from the
 *   picker without losing the row.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { requireAdmin } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { LineItemDepartment } from '@prisma/client'
import { parseMoney } from '@/lib/pricing/resolveRate'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const VALID_DEPARTMENTS = new Set<string>(Object.values(LineItemDepartment))

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const pkg = await prisma.package.findUnique({
    where: { id },
    include: {
      items: {
        include: { inventoryItem: { select: { id: true, code: true, description: true, dailyRate: true, weeklyRate: true, department: true } } },
      },
    },
  })
  if (!pkg) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(pkg)
}

export async function PUT(req: NextRequest, { params }: Params) {
  // Pricing mutation — ADMIN only. (GET stays session-level: the order
  // page's package picker reads it for any signed-in agent.)
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const { id } = await params
  const body = await req.json().catch(() => null) as {
    name?: string
    description?: string | null
    department?: string
    pricePerDay?: number | string
    active?: boolean
    items?: { inventoryItemId: string; qty: number }[]
  } | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (!body.name?.trim()) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    data.name = body.name.trim()
  }
  if (body.description !== undefined) data.description = body.description?.trim() || null
  if (body.department !== undefined) {
    if (!VALID_DEPARTMENTS.has(body.department)) return NextResponse.json({ error: 'invalid department' }, { status: 400 })
    data.department = body.department as LineItemDepartment
  }
  if (body.pricePerDay !== undefined) {
    // Decimal-safe (audit §7): no Number() into a Decimal column.
    const price = parseMoney(body.pricePerDay)
    if (price === null || price.isNegative()) return NextResponse.json({ error: 'pricePerDay must be ≥ 0' }, { status: 400 })
    data.pricePerDay = price
  }
  if (body.active !== undefined) data.active = !!body.active

  // Items: REPLACE-all on update. Diff-and-patch would be cleaner but
  // the admin UI loads + saves the whole list, so a clean replace
  // matches what the rep sees. Done inside a transaction so a partial
  // failure can't leave the package half-edited.
  if (body.items !== undefined) {
    const items = body.items.filter((it) => it.inventoryItemId && it.qty > 0)
    await prisma.$transaction([
      prisma.package.update({ where: { id }, data }),
      prisma.packageItem.deleteMany({ where: { packageId: id } }),
      prisma.packageItem.createMany({
        data: items.map((it) => ({
          packageId: id,
          inventoryItemId: it.inventoryItemId,
          qty: Math.max(1, Math.floor(it.qty)),
        })),
      }),
    ])
  } else if (Object.keys(data).length > 0) {
    await prisma.package.update({ where: { id }, data })
  }

  const updated = await prisma.package.findUnique({
    where: { id },
    include: {
      items: {
        include: { inventoryItem: { select: { id: true, code: true, description: true, dailyRate: true } } },
      },
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const { id } = await params
  await prisma.package.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
