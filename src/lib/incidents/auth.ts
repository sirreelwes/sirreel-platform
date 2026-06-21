import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'

/**
 * Phase 3 worklist-edit gate for /api/incidents/[id] PATCH. Uses the
 * existing `canManageClaims` perm (widened in Phase 3 to ADMIN +
 * MANAGER + AGENT — "claims" being the legacy term for what's now
 * the Incidents surface).
 *
 *   const gate = await requireIncidentEditAccess()
 *   if (gate instanceof NextResponse) return gate
 *   const { user } = gate
 */
export async function requireIncidentEditAccess() {
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
  if (!perms.canManageClaims) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return { user }
}
