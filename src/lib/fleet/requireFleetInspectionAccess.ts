/**
 * Server-side guard for the pre-rental inspection checkout flow
 * (Sprint 2A). Explicit role set — NOT the `dispatch` permission,
 * which includes AGENT; the inspection surface is yard-ops only:
 * ADMIN, MANAGER, FLEET_TECH, WAREHOUSE. AGENT/CLIENT/DRIVER are rejected
 * server-side (403), not just hidden in the UI. (DISPATCHER dropped —
 * being retired into FLEET_TECH; no live DISPATCHER users exist.)
 *
 * Modeled on src/lib/fleet/requireDispatchAccess.ts.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'

// WAREHOUSE added 2026-09-02 with the fleet/warehouse merge (Wes:
// "combine fleet and warehouse into one view"). The merged /yard board
// puts a truck and its carts in one card, so the person who pulls the
// carts is also the person standing in front of the truck; leaving them
// out meant tapping Inspect on their own board returned a 403. This is
// a real widening — a picker can now submit a pre-rental walkaround —
// and it is the intended one: there is one yard crew.
const ALLOWED_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  'ADMIN',
  'MANAGER',
  'FLEET_TECH',
  'WAREHOUSE',
])

export type RequireFleetInspectionAccessResult =
  | { ok: true; userId: string; role: UserRole; name: string | null }
  | { ok: false; response: NextResponse }

export async function requireFleetInspectionAccess(): Promise<RequireFleetInspectionAccessResult> {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    }
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, isActive: true, name: true },
  })
  if (!user || !user.isActive) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    }
  }
  if (!ALLOWED_ROLES.has(user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'forbidden', reason: 'fleet inspection requires ADMIN, MANAGER, FLEET_TECH or WAREHOUSE' },
        { status: 403 },
      ),
    }
  }
  return { ok: true, userId: user.id, role: user.role, name: user.name }
}

/** Page-side variant: returns the user or null (page renders its own 403). */
export async function getFleetInspectionUser(): Promise<{ userId: string; role: UserRole; name: string | null } | null> {
  const auth = await requireFleetInspectionAccess()
  return auth.ok ? { userId: auth.userId, role: auth.role, name: auth.name } : null
}
