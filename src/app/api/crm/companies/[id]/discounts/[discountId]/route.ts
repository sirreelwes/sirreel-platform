/**
 * PATCH / DELETE /api/crm/companies/[id]/discounts/[discountId]
 *
 * PATCH edits a standing discount; DELETE deactivates it rather than
 * removing the row. A discount that ended is account history — "what were
 * we giving them last season" is a real question, and the orders it priced
 * still point at the deal by label.
 *
 * Editing changes NOTHING about orders already created. The discount was
 * copied onto each order at create time precisely so a renegotiation in
 * June cannot re-price a quote sent in March. See
 * src/lib/orders/applyStandingDiscounts.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { LineItemDepartment } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCompanyTermsEditor } from '@/lib/portal/companyTermsEditors'

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
  return prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
}

function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? undefined : d
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; discountId: string } },
) {
  const g = await requireCompanyTermsEditor()
  if ('error' in g) return g.error
  const user = g.user

  const existing = await prisma.companyDiscount.findFirst({
    where: { id: params.discountId, companyId: params.id },
    select: { id: true, departmentKey: true, inventoryItemIds: true },
  })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const data: Record<string, unknown> = {}

  if (typeof b.label === 'string') {
    const label = b.label.trim().slice(0, 160)
    if (!label) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 })
    data.label = label
  }
  if (b.percentOff !== undefined) {
    const pct = Math.round(Number(b.percentOff))
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      return NextResponse.json({ error: 'Percent off must be between 1 and 100.' }, { status: 400 })
    }
    data.percentOff = pct
  }
  if (b.departmentKey !== undefined) {
    data.departmentKey =
      typeof b.departmentKey === 'string' &&
      DEPARTMENTS.includes(b.departmentKey as LineItemDepartment)
        ? b.departmentKey
        : null
  }
  if (Array.isArray(b.inventoryItemIds)) {
    data.inventoryItemIds = [
      ...new Set(b.inventoryItemIds.filter((x): x is string => typeof x === 'string' && !!x)),
    ]
  }
  if (typeof b.conditions === 'string') data.conditions = b.conditions.trim().slice(0, 500) || null
  if (typeof b.internalNote === 'string') {
    data.internalNote = b.internalNote.trim().slice(0, 1000) || null
  }
  const eff = parseDate(b.effectiveDate)
  if (eff !== undefined) data.effectiveDate = eff
  const exp = parseDate(b.expiryDate)
  if (exp !== undefined) data.expiryDate = exp
  if (typeof b.isActive === 'boolean') data.isActive = b.isActive
  if (Number.isFinite(Number(b.sortOrder))) data.sortOrder = Number(b.sortOrder)

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // The department / items split has to survive an edit, not just a create.
  const nextDept =
    'departmentKey' in data ? (data.departmentKey as string | null) : existing.departmentKey
  const nextItems =
    'inventoryItemIds' in data
      ? (data.inventoryItemIds as string[])
      : existing.inventoryItemIds
  if (!nextDept && nextItems.length === 0) {
    return NextResponse.json(
      { error: 'A discount needs either a department or a set of items.' },
      { status: 400 },
    )
  }
  if (nextDept && nextItems.length > 0) {
    return NextResponse.json(
      { error: 'A discount is either a whole department or a set of items, not both.' },
      { status: 400 },
    )
  }

  const updated = await prisma.companyDiscount.update({
    where: { id: existing.id },
    data,
    select: { id: true, label: true, percentOff: true, isActive: true },
  })
  return NextResponse.json({ ok: true, discount: updated })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; discountId: string } },
) {
  const g = await requireCompanyTermsEditor()
  if ('error' in g) return g.error
  const user = g.user

  const existing = await prisma.companyDiscount.findFirst({
    where: { id: params.discountId, companyId: params.id },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.companyDiscount.update({
    where: { id: existing.id },
    data: { isActive: false },
  })
  return NextResponse.json({ ok: true })
}
