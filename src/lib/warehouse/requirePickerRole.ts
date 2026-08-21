/**
 * Server-side guard for the Phase 2 warehouse picking endpoints.
 *
 * Derives from the permissions matrix (`getPermissions(role).warehouse`)
 * instead of a hardcoded role list — the matrix and this gate can no
 * longer drift (they did until 2026-08-21: two independent ADMIN/MANAGER
 * lists). Passing roles today: ADMIN, MANAGER, WAREHOUSE. AGENT stays
 * excluded — sales agents don't pick warehouse orders (Phase 2
 * confirmation, answer 5).
 *
 * Usage:
 *   const auth = await requirePickerRole()
 *   if (!auth.ok) return auth.response
 *   const { userId, role } = auth
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'

export type RequirePickerRoleResult =
  | { ok: true; userId: string; role: UserRole }
  | { ok: false; response: NextResponse }

export async function requirePickerRole(): Promise<RequirePickerRoleResult> {
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

  if (!getPermissions(user.role).warehouse) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'forbidden', reason: 'warehouse picking is gated to warehouse-enabled roles' },
        { status: 403 },
      ),
    }
  }

  return { ok: true, userId: user.id, role: user.role }
}
