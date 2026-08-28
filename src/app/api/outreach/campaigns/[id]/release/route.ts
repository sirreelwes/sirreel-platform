/**
 * POST /api/outreach/campaigns/[id]/release — actually send.
 *
 * The only endpoint in the app that can put marketing mail in front of a
 * client, and it does nothing until Phase 2's guard agrees: the master
 * switch on, a warmed outreach subdomain configured, the recipient not
 * suppressed, and the daily caps not spent.
 *
 * Re-entrant by design. If it times out partway, calling it again picks
 * up the remaining PENDING rows — the unique key on (campaign, person)
 * means nobody can be mailed twice.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { releaseCampaign } from '@/lib/outreach/campaign'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const result = await releaseCampaign(id, user.id)
    if (result.blocked) {
      // 409, not 500: nothing is broken. The guard did its job and the
      // rep needs to read why.
      return NextResponse.json({ ok: false, blocked: result.blocked, ...result }, { status: 409 })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[outreach/release]', reason)
    return NextResponse.json({ error: reason }, { status: 500 })
  }
}
