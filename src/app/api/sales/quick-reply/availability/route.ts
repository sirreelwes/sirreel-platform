/**
 * POST /api/sales/quick-reply/availability — per-category pooled availability
 * for the Quick Reply flow, computed from the real engine (getCategoryAvailability).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeQuickReplyAvailability } from '@/lib/sales/quickReply'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const categories = Array.isArray(body.categories) ? body.categories : []
  const lines = await computeQuickReplyAvailability(categories, body.pickup, body.return)
  return NextResponse.json({ ok: true, lines })
}
