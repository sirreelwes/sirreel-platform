/**
 * Server-side guard for FLEET DOCUMENTS / OPS ONLY: the dot-sheet, the BIT
 * list/upload + BIT PDF routes, and the read-only dispatch board.
 *
 * Gated on the `canAssignAssets` permission (fleet capability). NOTE (2026-07
 * re-split): reservation control moved OFF this helper — the scheduling
 * assign/unassign/confirm routes (like promote/release before them) now gate
 * directly on canCreateBooking (sales). Do NOT add reservation routes back
 * here; this guard is for fleet paperwork and ops surfaces.
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
