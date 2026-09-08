/**
 * Server-side accounts-payable gate. Wrapped around EVERY /api/ap route,
 * reads included — the desk exposes vendor pricing and sub-rental cost
 * against client billing, so a GET that leaks the list is the same
 * disclosure as a write.
 *
 * The membership test lives in ./allowlist so permissions.ts can import it
 * without dragging next-auth into the client bundle.
 *
 *   import { requireApUser } from '@/lib/ap/access'
 *   const me = await requireApUser()
 *   if (me instanceof NextResponse) return me
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { isAllowedApEmail } from './allowlist'

export { isAllowedApEmail }

export interface AllowedApUser {
  id: string
  email: string
  name: string
}

/**
 * Returns the User row, or a NextResponse the caller must return immediately.
 *
 * 403 rather than 404 on a denied request, matching payroll and HR: a missed
 * gate should be loud in the logs, not disguised as a typo'd URL.
 */
export async function requireApUser(): Promise<AllowedApUser | NextResponse> {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const email = session.user.email.toLowerCase()
  if (!isAllowedApEmail(email)) {
    return NextResponse.json({ error: 'forbidden — accounts payable is restricted' }, { status: 403 })
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
