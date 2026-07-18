/**
 * GET /api/action-items?view=mine|all[&count=1] — the Action Items
 * engine, per signed-in user. `count=1` returns just the badge count.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getActionItemsForUser, getActionItemCount } from '@/lib/actionItems/registry'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const email = session.user.email
  const url = new URL(req.url)

  if (url.searchParams.get('count') === '1') {
    const count = await getActionItemCount(email)
    return NextResponse.json({ ok: true, count })
  }

  const view = url.searchParams.get('view') === 'all' ? 'all' : 'mine'
  const { items, canSeeAll, role } = await getActionItemsForUser(email, view)
  return NextResponse.json({ ok: true, items, canSeeAll, role, view })
}
