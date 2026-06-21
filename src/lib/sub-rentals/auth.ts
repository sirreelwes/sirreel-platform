import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'

/**
 * Sub-rental + vendor mutation gate. Returns the calling user on
 * success, or a NextResponse to short-circuit with.
 *
 * Phase 1 scope:
 *   - AGENT (Jose / Oliver / Ana — sales + billing)
 *   - MANAGER (Hugo — warehouse + fleet GM)
 *   - ADMIN (Wes / Dani)
 *
 * Phase 2+ receive-from-vendor + return actions will narrow further
 * to MANAGER + ADMIN only — that's a separate gate, not this one.
 *
 *   const gate = await requireSubRentalAccess()
 *   if (gate instanceof NextResponse) return gate
 *   const { user } = gate
 */
export async function requireSubRentalAccess() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, email: true, name: true, salesOnly: true },
  })
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const perms = getPermissions({ role: user.role, salesOnly: user.salesOnly, email: user.email })
  if (!perms.subRentals) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return { user }
}
