/**
 * HR access allowlist. Code-reviewed constant — NOT DB-managed.
 *
 * The rejected alternative: an Employee.hasHrAccess boolean. That
 * would let any UI or migration that can write the Employee table
 * escalate HR privileges by accident (e.g. a CSV import bug, an
 * admin nav row, a future "edit employee" form that doesn't
 * carefully gate the boolean). HR access is the most consequential
 * permission in the system; it should only change via a code review
 * + deploy.
 *
 * The env override exists for emergency expansion (e.g., bringing
 * an attorney in for an active complaint). Set HR_ALLOWLIST in
 * Vercel as a comma-separated list of emails; it merges with the
 * constant, doesn't replace it. Removing the override (or removing
 * names from it) is also one-deploy-fast.
 *
 * Usage:
 *   import { requireHrAccess } from '@/lib/hr/allowlist'
 *   const me = await requireHrAccess()
 *   if (me instanceof NextResponse) return me  // 403 already returned
 *   // ... me is the User row with HR access
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

const HR_ALLOWLIST_BASE: ReadonlyArray<string> = [
  'wes@sirreel.com',
  'dani@sirreel.com',
]

function normalizedAllowlist(): Set<string> {
  const set = new Set<string>(HR_ALLOWLIST_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.HR_ALLOWLIST
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(e)
    }
  }
  return set
}

export function isAllowedHrEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return normalizedAllowlist().has(email.toLowerCase())
}

export interface AllowedHrUser {
  id: string
  email: string
  name: string
}

/**
 * Auth + allowlist gate for every HR API route. Returns either the
 * User row (allowed) or a NextResponse that the caller should return
 * immediately (401 unauthorized OR 403 forbidden, never 404 — we
 * deliberately tell the caller the route exists but they can't see
 * it, so a missed gate is obvious in logs).
 */
export async function requireHrAccess(): Promise<AllowedHrUser | NextResponse> {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const email = session.user.email.toLowerCase()
  if (!isAllowedHrEmail(email)) {
    return NextResponse.json({ error: 'forbidden — HR access restricted' }, { status: 403 })
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  })
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return user
}
