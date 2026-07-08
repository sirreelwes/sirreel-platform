/**
 * Server-side guard for fleet asset-assignment actions: the scheduling
 * assign/unassign/promote/release + booking-confirm routes, the dot-sheet /
 * BIT PDFs, and the dispatch board.
 *
 * Gated on the `canAssignAssets` permission — the fleet capability (ADMIN,
 * MANAGER, FLEET_TECH, DISPATCHER); AGENT is excluded. Repointed off the
 * legacy `dispatch` perm (STEP 5 of retiring DISPATCHER): for every role
 * canAssignAssets equals the old `dispatch` value, so no access changed. The
 * function name is kept to minimize blast radius across its callers.
 *
 * Modeled on src/lib/warehouse/requirePickerRole.ts. Returns a
 * discriminated result so route handlers do:
 *
 *   const auth = await requireDispatchAccess()
 *   if (!auth.ok) return auth.response
 *   const { userId, role } = auth
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'

export type RequireDispatchAccessResult =
  | { ok: true; userId: string; role: UserRole }
  | { ok: false; response: NextResponse }

export async function requireDispatchAccess(): Promise<RequireDispatchAccessResult> {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    }
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    }
  }

  if (!can(user.role, 'canAssignAssets')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'forbidden', reason: 'this action requires the fleet asset-assignment permission' },
        { status: 403 },
      ),
    }
  }

  return { ok: true, userId: user.id, role: user.role }
}
