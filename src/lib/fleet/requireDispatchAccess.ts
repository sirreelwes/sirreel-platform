/**
 * Server-side guard for the Phase 4 dispatch board.
 *
 * Read-only surface — gated on the existing `dispatch` permission so
 * the same five operational roles that get the legacy Dispatch nav
 * entry (ADMIN, MANAGER, AGENT, FLEET_TECH, DISPATCHER) see the new
 * board. No permissions.ts churn — the perm already covers them.
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

  if (!can(user.role, 'dispatch')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'forbidden', reason: 'dispatch board requires the dispatch permission' },
        { status: 403 },
      ),
    }
  }

  return { ok: true, userId: user.id, role: user.role }
}
