/**
 * Server gate for creating an order.
 *
 * Hugo, 2026-09-03: "create order should not be possible from
 * Fleet/Warehouse view/login. That is only for sales."
 *
 * POST /api/orders had NO role check at all — any signed-in staff
 * session could create one. The nav never offered the yard crew a way
 * in, which is not the same thing as their not being able to.
 *
 * The predicate is canCreateOrders() so the button, the page guard and
 * this all answer from one place.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canCreateOrders } from '@/lib/permissions'

export async function requireOrderCreateAccess() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, email: true, name: true, salesOnly: true, isActive: true },
  })
  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (!canCreateOrders({ role: user.role, salesOnly: user.salesOnly, email: user.email ?? undefined })) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'Only sales can create an order. Change what goes out on the check-out report instead.' },
      { status: 403 },
    )
  }
  return { user }
}
