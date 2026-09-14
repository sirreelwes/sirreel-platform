import { NextResponse } from 'next/server'
import { requireDeskViewer } from '@/lib/collections/access'
import { buildDeskActivity } from '@/lib/collections/deskActivity'

/**
 * GET /api/collections/desk — the live collections desk: money in, outreach
 * out, and the attributed feed underneath both.
 *
 * Read-only, and deliberately uncached — the panel polls it, so a cached
 * response would show a stale desk while claiming to be live.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireDeskViewer()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const activity = await buildDeskActivity()
  return NextResponse.json({ ok: true, ...activity })
}
