/**
 * Dedup-tool access allowlist — cloned from the HR pattern at
 * src/lib/hr/allowlist.ts (same shape, same env-override semantics).
 *
 * Why a separate allowlist and not just admin role: dedup actions are
 * irreversible (well, audited-reversible, but easy to fire and hard to
 * un-fire when many merges stack up). HR-style explicit allowlist with
 * code-review-gated changes is the right ceiling. The env override
 * `DEDUP_ALLOWLIST` is for short-term expansion (bringing a contractor
 * in for a one-week cleanup pass), same as HR.
 *
 * Usage:
 *   import { requireDedupAccess } from '@/lib/people/dedupAccess'
 *   const me = await requireDedupAccess()
 *   if (me instanceof NextResponse) return me  // 401/403 already returned
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

// The allowlist itself lives in dedupAllowlist.ts — no server imports there,
// so the /crm entry point can ask the same question client-side. Re-exported
// here so existing importers of this module are unaffected.
export { isAllowedDedupEmail, normalizedAllowlist } from './dedupAllowlist'
import { isAllowedDedupEmail } from './dedupAllowlist'

export interface AllowedDedupUser {
  id: string
  email: string
  name: string
}

export async function requireDedupAccess(): Promise<AllowedDedupUser | NextResponse> {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const email = session.user.email.toLowerCase()
  if (!isAllowedDedupEmail(email)) {
    return NextResponse.json({ error: 'forbidden — dedup access restricted' }, { status: 403 })
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
