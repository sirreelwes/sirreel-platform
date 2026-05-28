/**
 * Server-side guard for the Phase 2 warehouse picking endpoints.
 *
 * Role-gated to ADMIN | MANAGER. AGENT is explicitly excluded — sales
 * agents don't pick warehouse orders, and granting them access muddies
 * the role semantics (per Phase 2 confirmation, answer 5).
 *
 * PARKING LOT: when a dedicated picker user gets provisioned (likely
 * Chris Valencia), add a WAREHOUSE role to UserRole and include it in
 * ALLOWED_ROLES below. No other change needed in this helper.
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

const ALLOWED_ROLES: ReadonlyArray<UserRole> = ['ADMIN', 'MANAGER'] as const

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

  if (!ALLOWED_ROLES.includes(user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'forbidden', reason: 'warehouse picking is gated to ADMIN/MANAGER' },
        { status: 403 },
      ),
    }
  }

  return { ok: true, userId: user.id, role: user.role }
}
