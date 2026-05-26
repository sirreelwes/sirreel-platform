/**
 * Shared server-side guard for /api/exec/* endpoints.
 *
 * Pairs with the `coverage` permission in src/lib/permissions.ts so the
 * sidebar nav and the API access check read from the SAME source of
 * truth — nav-hiding alone is not access control, and a sensitive
 * namespace (approvals now, claims $ + escalations Phase 2) deserves
 * both layers wired to the same flag.
 *
 * Usage at the top of each /api/exec/* route handler:
 *
 *   const guard = await requireCoverageAccess()
 *   if (!guard.ok) return guard.response
 *   // ...guard.user is the authenticated User row (id, email, role)
 *
 * Returns 401 when there is no session (or no DB user for the session
 * email) and 403 when the role lacks the coverage permission.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import type { UserRole } from '@prisma/client'

export interface CoverageGuardUser {
  id: string
  email: string
  role: UserRole
}

export type CoverageGuardResult =
  | { ok: true; user: CoverageGuardUser }
  | { ok: false; response: NextResponse }

export async function requireCoverageAccess(): Promise<CoverageGuardResult> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? null
  if (!email) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    }
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true },
  })
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    }
  }

  if (!can(user.role, 'coverage')) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return { ok: true, user }
}
