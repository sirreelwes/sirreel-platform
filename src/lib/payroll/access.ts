/**
 * Server-side payroll gate. Wrapped around EVERY payroll route, reads
 * included — hours are compensation data, and a GET that leaks the whole
 * crew's schedule is as bad as a POST that edits it.
 *
 * The membership test itself lives in ./allowlist so permissions.ts can import
 * it without dragging next-auth into the client bundle.
 *
 *   import { requirePayrollAccess } from '@/lib/payroll/access'
 *   const me = await requirePayrollAccess()
 *   if (me instanceof NextResponse) return me
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { isAllowedPayrollEmail } from './allowlist'

export { isAllowedPayrollEmail }

export interface AllowedPayrollUser {
  id: string
  email: string
  name: string
}

/**
 * Returns the User row, or a NextResponse the caller must return immediately.
 *
 * 403 rather than 404 on a denied request, matching HR: a missed gate should
 * be loud in the logs, not disguised as a typo'd URL.
 */
export async function requirePayrollAccess(): Promise<AllowedPayrollUser | NextResponse> {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const email = session.user.email.toLowerCase()
  if (!isAllowedPayrollEmail(email)) {
    return NextResponse.json({ error: 'forbidden — payroll access restricted' }, { status: 403 })
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
