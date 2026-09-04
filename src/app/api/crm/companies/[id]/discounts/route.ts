/**
 * GET / POST /api/crm/companies/[id]/discounts — the client's standing
 * discounts.
 *
 * Wes 2026-09-04: "At the top should be their company discounts if entered
 * by SirReel … These discounts should be auto applied in all orders from
 * that company going forward."
 *
 * Both halves of that sentence live behind this endpoint: the row is what
 * the executive reads on their portal AND what prices their next order.
 * Which is why the validation here is stricter than a display-only record
 * would need — a fat-fingered 500% or a discount with no target would
 * reach real quotes.
 *
 * SCOPE IS EXCLUSIVE. A row is either department-wide or item-scoped,
 * never both: the two auto-apply through different mechanisms (an
 * OrderDiscount row vs. a reduced rate), and a row carrying both would
 * discount the same line twice. The 400 says so rather than silently
 * dropping one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { LineItemDepartment } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const DEPARTMENTS: LineItemDepartment[] = [
  'VEHICLES',
  'COMMUNICATIONS',
  'STAGES',
  'PRO_SUPPLIES',
  'EXPENDABLES',
  'GE',
  'ART',
  'WARDROBE_MAKEUP',
]

async function requireUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
}

function parseDate(v: unknown): Date | null {
  if (v == null || v === '') return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const rows = await prisma.companyDiscount.findMany({
    where: { companyId: params.id },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { percentOff: 'desc' }],
    select: {
      id: true,
      label: true,
      percentOff: true,
      departmentKey: true,
      inventoryItemIds: true,
      conditions: true,
      internalNote: true,
      effectiveDate: true,
      expiryDate: true,
      isActive: true,
      sortOrder: true,
      createdAt: true,
    },
  })

  // Name the items so the panel can show "Cube Truck, Cargo Van" rather
  // than a row of uuids.
  const itemIds = [...new Set(rows.flatMap((r) => r.inventoryItemIds))]
  const items = itemIds.length
    ? await prisma.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        // InventoryItem has no `name` — the human label is
        // description, falling back to the code.
        select: { id: true, code: true, description: true },
      })
    : []
  const nameById = new Map(items.map((i) => [i.id, i.description || i.code]))

  return NextResponse.json({
    ok: true,
    discounts: rows.map((r) => ({
      ...r,
      itemNames: r.inventoryItemIds.map((id) => nameById.get(id) || '(removed item)'),
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!company) return NextResponse.json({ error: 'company not found' }, { status: 404 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 160) : ''
  if (!label) {
    return NextResponse.json(
      { error: 'Give it a client-facing name — "Production supply orders".' },
      { status: 400 },
    )
  }

  const percentOff = Math.round(Number(b.percentOff))
  if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 100) {
    return NextResponse.json({ error: 'Percent off must be between 1 and 100.' }, { status: 400 })
  }

  const departmentKey =
    typeof b.departmentKey === 'string' && DEPARTMENTS.includes(b.departmentKey as LineItemDepartment)
      ? (b.departmentKey as LineItemDepartment)
      : null

  const inventoryItemIds = Array.isArray(b.inventoryItemIds)
    ? [...new Set(b.inventoryItemIds.filter((x): x is string => typeof x === 'string' && !!x))]
    : []

  if (!departmentKey && inventoryItemIds.length === 0) {
    return NextResponse.json(
      {
        error:
          'Pick a department, or pick the specific items this covers — otherwise nothing knows what to discount.',
      },
      { status: 400 },
    )
  }
  if (departmentKey && inventoryItemIds.length > 0) {
    return NextResponse.json(
      {
        error:
          'A discount is either a whole department or a set of items, not both — a row carrying both would discount the same line twice.',
      },
      { status: 400 },
    )
  }

  // Verify the item ids exist before they start pricing quotes.
  if (inventoryItemIds.length > 0) {
    const found = await prisma.inventoryItem.count({ where: { id: { in: inventoryItemIds } } })
    if (found !== inventoryItemIds.length) {
      return NextResponse.json({ error: 'One or more of those items no longer exist.' }, { status: 400 })
    }
  }

  const effectiveDate = parseDate(b.effectiveDate)
  const expiryDate = parseDate(b.expiryDate)
  if (effectiveDate && expiryDate && expiryDate.getTime() < effectiveDate.getTime()) {
    return NextResponse.json({ error: 'The end date is before the start date.' }, { status: 400 })
  }

  const created = await prisma.companyDiscount.create({
    data: {
      companyId: company.id,
      label,
      percentOff,
      departmentKey,
      inventoryItemIds,
      conditions:
        typeof b.conditions === 'string' ? b.conditions.trim().slice(0, 500) || null : null,
      internalNote:
        typeof b.internalNote === 'string' ? b.internalNote.trim().slice(0, 1000) || null : null,
      effectiveDate,
      expiryDate,
      sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0,
      createdById: user.id,
    },
    select: { id: true, label: true, percentOff: true, departmentKey: true },
  })

  return NextResponse.json({ ok: true, discount: created }, { status: 201 })
}
