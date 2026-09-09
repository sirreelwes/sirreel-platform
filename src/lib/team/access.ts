/**
 * Server-side gate for the team-metrics desk. Wrapped around every
 * /api/team route.
 *
 * Read-only data, but a read IS the disclosure here: the whole point of the
 * page is a comparative judgement about named employees. A leaked GET is the
 * entire harm.
 *
 *   import { requireTeamMetricsUser } from '@/lib/team/access'
 *   const me = await requireTeamMetricsUser()
 *   if (me instanceof NextResponse) return me
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { isAllowedTeamMetricsEmail } from './allowlist'

export { isAllowedTeamMetricsEmail }

export interface AllowedTeamMetricsUser {
  id: string
  email: string
  name: string
}

/** 403 rather than 404 on a denied request — a missed gate should be loud in
 *  the logs, not disguised as a typo'd URL. Matches payroll, HR and AP. */
export async function requireTeamMetricsUser(): Promise<AllowedTeamMetricsUser | NextResponse> {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const email = session.user.email.toLowerCase()
  if (!isAllowedTeamMetricsEmail(email)) {
    return NextResponse.json({ error: 'forbidden — team metrics is restricted' }, { status: 403 })
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
