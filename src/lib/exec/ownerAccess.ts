import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isOwnerNumbersViewer } from './ownerAllowlist'

/**
 * Server gate for /exec/numbers. The nav row is hidden by the same predicate,
 * but hiding a link is not access control — the page calls this.
 *
 * Returns the user, or null for anyone else (signed out, deactivated, or
 * simply not on the list).
 */
export async function requireOwnerViewer(): Promise<{ id: string; name: string } | null> {
  // authOptions is required: bare getServerSession() does not reliably
  // resolve in the app router, and a silent null would lock Wes out.
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.toLowerCase()
  if (!email || !isOwnerNumbersViewer(email)) return null

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, isActive: true },
  })
  if (!user || !user.isActive) return null
  return { id: user.id, name: user.name }
}
