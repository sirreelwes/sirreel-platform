/**
 * POST /api/action-items/dismiss — mark one item handled for the
 * signed-in user. Body: { itemId, dismissal }. Routes to the Alert
 * dismissed_by[] (EVENT) or the ActionItemDismissal side-row (DERIVED)
 * via the registry — the same per-user dismiss pattern already used
 * across the app.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { dismissActionItem } from '@/lib/actionItems/registry'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    | { itemId?: unknown; dismissal?: unknown }
    | null
  const itemId = typeof body?.itemId === 'string' ? body.itemId : null
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })

  const d = body?.dismissal as { kind?: unknown; alertId?: unknown } | undefined
  let dismissal: { kind: 'alert'; alertId: string } | { kind: 'sideRow' }
  if (d?.kind === 'alert' && typeof d.alertId === 'string') {
    dismissal = { kind: 'alert', alertId: d.alertId }
  } else {
    dismissal = { kind: 'sideRow' }
  }

  await dismissActionItem(session.user.email, itemId, dismissal)
  return NextResponse.json({ ok: true })
}
