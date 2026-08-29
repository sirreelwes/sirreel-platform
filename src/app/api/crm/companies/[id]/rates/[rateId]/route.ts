import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; rateId: string }> }

/**
 * Remove one negotiated rate — the client goes back to list pricing on
 * that item. Existing quotes are untouched: their lines already carry a
 * `rate` and (post quote-send) a `resolvedRate` snapshot.
 *
 * ADMIN only, matching the POST gate on the parent route.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, email: true, salesOnly: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const perms = getPermissions({ role: user.role, salesOnly: user.salesOnly, email: user.email })
  if (!perms.seePricing || user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { id: companyId, rateId } = await params
  const existing = await prisma.companyRate.findUnique({
    where: { id: rateId },
    include: { inventoryItem: { select: { code: true, description: true } } },
  })
  // Scoped to the company in the path so a stray id can't delete another
  // client's deal.
  if (!existing || existing.companyId !== companyId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  await prisma.companyRate.delete({ where: { id: rateId } })
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'company.rate.delete',
      entityType: 'CompanyRate',
      entityId: rateId,
      oldValues: {
        companyId,
        item: existing.inventoryItem.description || existing.inventoryItem.code,
        dailyRate: existing.dailyRate?.toFixed(2) ?? null,
        weeklyRate: existing.weeklyRate?.toFixed(2) ?? null,
        note: existing.note,
      },
      newValues: {},
    },
  })

  return NextResponse.json({ ok: true })
}
