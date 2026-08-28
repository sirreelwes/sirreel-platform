/**
 * GET /api/outreach/scoreboard — the outreach funnel.
 *
 * Read-only. Every figure is zero until the sending domain is warmed and
 * a first campaign runs; the payload carries `firstSendAt: null` so the
 * UI can say "nothing sent yet" instead of rendering an empty funnel
 * that looks like a failure.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { buildScoreboard } from '@/lib/outreach/scoreboard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await buildScoreboard())
}
