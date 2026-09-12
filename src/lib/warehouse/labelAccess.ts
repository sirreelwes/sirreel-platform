/**
 * Door for /warehouse/labels and its two routes: yard staff OR sales.
 *
 * The yard crew labels gear; Wes (2026-09-12): "let sales mint labels
 * too" — Oliver asked for the barcodes in the first place, and a rep
 * receiving a new piece should not have to find a warehouse login to
 * give it a number. Everything else behind the yard door (the desk, the
 * pick lists, Find a Unit) keeps `requireYardAccess`.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { isSalesRole } from '@/lib/permissions'
import { requireYardAccess, type RequireYardAccessResult, type YardUser } from '@/lib/yard/requireYardAccess'

export async function requireLabelAccess(): Promise<RequireYardAccessResult> {
  const yard = await requireYardAccess()
  if (yard.ok || yard.response.status !== 403) return yard

  const session = await getServerSession()
  const email = session?.user?.email
  if (!email) return yard
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, isActive: true, name: true },
  })
  if (user && user.isActive && isSalesRole(user.role)) {
    return { ok: true, userId: user.id, role: user.role, name: user.name }
  }
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'forbidden', reason: 'label printing is for yard staff and sales' },
      { status: 403 },
    ),
  }
}

/** Page-side variant: the user, or null so the page can render its own 403. */
export async function getLabelUser(): Promise<YardUser | null> {
  const auth = await requireLabelAccess()
  return auth.ok ? { userId: auth.userId, role: auth.role, name: auth.name } : null
}
