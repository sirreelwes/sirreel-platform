/**
 * Guard for the merged yard surface (/yard and /api/yard).
 *
 * The old split had two guards for one crew: requireFleetInspectionAccess
 * (ADMIN/MANAGER/FLEET_TECH) and requirePickerRole (ADMIN/MANAGER/
 * WAREHOUSE). A board that shows trucks AND carts has to admit whoever
 * touches either, or half the cards 403 and the page reads as broken.
 *
 * Derived from the permissions matrix rather than a role list, so it
 * cannot drift from it the way the two old lists did: anyone with the
 * `fleet` OR the `warehouse` flag is yard staff. Today that's ADMIN,
 * MANAGER, FLEET_TECH, WAREHOUSE and the retiring DISPATCHER.
 *
 * This is only the door. The per-action gates behind it are unchanged —
 * submitting an inspection still goes through requireFleetInspectionAccess,
 * and mutating a pick list still goes through requirePickerRole.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'

export type YardUser = { userId: string; role: UserRole; name: string | null }

export type RequireYardAccessResult =
  | ({ ok: true } & YardUser)
  | { ok: false; response: NextResponse }

export async function requireYardAccess(): Promise<RequireYardAccessResult> {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) }
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, isActive: true, name: true },
  })
  if (!user || !user.isActive) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) }
  }
  const perms = getPermissions(user.role)
  if (!perms.fleet && !perms.warehouse) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'forbidden', reason: 'the yard board is for fleet and warehouse staff' },
        { status: 403 },
      ),
    }
  }
  return { ok: true, userId: user.id, role: user.role, name: user.name }
}

/** Page-side variant: the user, or null so the page can render its own 403. */
export async function getYardUser(): Promise<YardUser | null> {
  const auth = await requireYardAccess()
  return auth.ok ? { userId: auth.userId, role: auth.role, name: auth.name } : null
}
