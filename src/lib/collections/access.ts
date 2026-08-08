import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Access gate for the collections workspace (/collections).
 *
 * Who: Wes and Dani (ADMIN), Ana (BILLING), and Jose.
 *
 * Jose is the reason this isn't a plain role check. He is AGENT, and gating on
 * AGENT would hand the ability to charge client cards to every current and
 * future sales agent — Oliver today, anyone hired tomorrow. An explicit
 * allowlist keeps the blast radius to the person actually named. Same pattern
 * as src/lib/people/dedupAccess.ts.
 *
 * Add someone by putting their address here, or by giving them BILLING if
 * collections is genuinely their job.
 */

const ROLE_ALLOWED = new Set(['ADMIN', 'BILLING'])

/** Individually-granted addresses. Lowercase. */
const EMAIL_ALLOWED = new Set(['jose@sirreel.com'])

export interface CollectionsUser {
  id: string
  name: string
  email: string
  role: string
}

/**
 * Resolve the signed-in staff user IF they may use collections, else null.
 * Returns the user so callers can stamp chargedById without a second lookup.
 */
export async function requireCollectionsUser(): Promise<CollectionsUser | null> {
  // authOptions is REQUIRED here. Bare getServerSession() does not reliably
  // resolve the session in the app router, and a silent null would lock every
  // authorised user out of the page rather than failing loudly.
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.toLowerCase()
  if (!email) return null

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) return null

  const allowed = ROLE_ALLOWED.has(String(user.role)) || EMAIL_ALLOWED.has(email)
  if (!allowed) return null

  return { id: user.id, name: user.name, email: user.email, role: String(user.role) }
}
