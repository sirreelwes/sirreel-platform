/**
 * GET /api/incidents/assignable-users
 *
 * Users eligible to be the Incident.assignee — the same set that can
 * EDIT incidents (Permissions.canManageClaims). After Phase 4a that's
 * ADMIN role OR an email on src/lib/claims/allowlist.ts (today:
 * Wes + Dani + Ana). Powers the inline owner picker on the Incidents
 * list cards.
 *
 * Auth: any authenticated session can READ the list (the picker is
 * shown to anyone who can see the cards; the PATCH that writes the
 * assignee is the gated action).
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // Pull all active staff users — we filter by canManageClaims in
  // process so we don't need a DB-side encoding of the perm table.
  // The set is small (<20 today) and changes rarely.
  const users = await prisma.user.findMany({
    where: {
      role: { in: ['ADMIN', 'MANAGER', 'AGENT', 'FLEET_TECH'] satisfies UserRole[] },
    },
    select: { id: true, name: true, email: true, role: true, salesOnly: true },
    orderBy: { name: 'asc' },
  })

  const eligible = users
    .filter((u) =>
      getPermissions({ role: u.role, salesOnly: u.salesOnly, email: u.email }).canManageClaims,
    )
    .map((u) => ({ id: u.id, name: u.name, role: u.role }))

  return NextResponse.json({ users: eligible })
}
