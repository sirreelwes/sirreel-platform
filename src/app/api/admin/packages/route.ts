/**
 * GET  /api/admin/packages — list every Package with item counts +
 *   computed component-value totals so the admin grid can show the
 *   implied discount without an N+1 fetch.
 *
 * POST /api/admin/packages — create a Package. Body:
 *   { name, description?, department, pricePerDay, items: [{ inventoryItemId, qty }] }
 *
 * Auth: getServerSession + staff role. Pattern mirrors existing
 *   admin endpoints (CRM / orders create flows).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { requireAdmin } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { LineItemDepartment } from '@prisma/client'

export const dynamic = 'force-dynamic'

const VALID_DEPARTMENTS = new Set<string>(Object.values(LineItemDepartment))

export async function GET(_req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const rows = await prisma.package.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      items: {
        include: {
          inventoryItem: {
            select: { id: true, code: true, description: true, dailyRate: true },
          },
        },
      },
    },
  })
  // Pre-compute component value sums so the list view can render
  // the discount % without iterating client-side.
  const packages = rows.map((p) => {
    const componentValue = p.items.reduce(
      (s, it) => s + Number(it.inventoryItem.dailyRate) * it.qty,
      0,
    )
    const price = Number(p.pricePerDay)
    const discountPct = componentValue > 0
      ? Math.round(((componentValue - price) / componentValue) * 100)
      : 0
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      department: p.department,
      pricePerDay: price,
      active: p.active,
      itemCount: p.items.length,
      componentValue,
      discountPct,
      items: p.items.map((it) => ({
        id: it.id,
        inventoryItemId: it.inventoryItemId,
        qty: it.qty,
        inventoryItem: {
          id: it.inventoryItem.id,
          code: it.inventoryItem.code,
          description: it.inventoryItem.description,
          dailyRate: Number(it.inventoryItem.dailyRate),
        },
      })),
    }
  })
  return NextResponse.json({ packages })
}

export async function POST(req: NextRequest) {
  // Pricing mutation — ADMIN only. (GET stays session-level: the order
  // page's package picker reads it for any signed-in agent.)
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const body = await req.json().catch(() => null) as {
    name?: string
    description?: string | null
    department?: string
    pricePerDay?: number | string
    active?: boolean
    items?: { inventoryItemId: string; qty: number }[]
  } | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!body.department || !VALID_DEPARTMENTS.has(body.department)) {
    return NextResponse.json({ error: 'invalid department' }, { status: 400 })
  }
  const price = Number(body.pricePerDay)
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: 'pricePerDay must be ≥ 0' }, { status: 400 })
  }
  const items = (body.items ?? []).filter((it) => it.inventoryItemId && it.qty > 0)

  const created = await prisma.package.create({
    data: {
      name: body.name.trim(),
      description: body.description?.trim() || null,
      department: body.department as LineItemDepartment,
      pricePerDay: price,
      active: body.active ?? true,
      items: {
        create: items.map((it) => ({
          inventoryItemId: it.inventoryItemId,
          qty: Math.max(1, Math.floor(it.qty)),
        })),
      },
    },
    include: {
      items: {
        include: { inventoryItem: { select: { id: true, code: true, description: true, dailyRate: true } } },
      },
    },
  })
  return NextResponse.json(created, { status: 201 })
}
