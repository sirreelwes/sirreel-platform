/**
 * Server-side guard for the physical vehicle handover (Sprint 2B).
 *
 * Deliberately a DIFFERENT role set from requireFleetInspectionAccess.
 * The pre-rental walkaround is a fleet-ops judgement call about vehicle
 * condition; handing keys to a driver is a counter operation, and Wes
 * (2026-08-22) put it primarily with WAREHOUSE and fleet. So WAREHOUSE is
 * allowed here and stays out of the inspection surface.
 *
 * Widening the inspection guard instead would have quietly granted
 * warehouse the damage-assessment flow too, which is not what was asked.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const ALLOWED_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  'ADMIN',
  'MANAGER',
  'FLEET_TECH',
  'WAREHOUSE',
])

export type RequireVehicleHandoverAccessResult =
  | { ok: true; userId: string; role: UserRole; name: string | null }
  | { ok: false; response: NextResponse }

export async function requireVehicleHandoverAccess(): Promise<RequireVehicleHandoverAccessResult> {
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
  if (!ALLOWED_ROLES.has(user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'forbidden', reason: 'vehicle handover requires ADMIN, MANAGER, FLEET_TECH, or WAREHOUSE' },
        { status: 403 },
      ),
    }
  }
  return { ok: true, userId: user.id, role: user.role, name: user.name }
}

/** Page-side variant — null instead of a NextResponse. */
export async function getVehicleHandoverUser(): Promise<{ userId: string; role: UserRole; name: string | null } | null> {
  const auth = await requireVehicleHandoverAccess()
  return auth.ok ? { userId: auth.userId, role: auth.role, name: auth.name } : null
}
