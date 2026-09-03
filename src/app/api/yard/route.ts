/**
 * GET /api/yard — feed for the merged yard board (refresh, day switch).
 *
 * ?date=YYYY-MM-DD selects the day; omitted means today in Pacific.
 * The crew preps tomorrow's loads this afternoon, which is why the day
 * is a parameter at all — /fleet/today could only ever show today, so
 * "what's going out first thing" had no screen.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import { yardBoardFor, pacificYmd } from '@/lib/yard/board'

export const dynamic = 'force-dynamic'

const YMD = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response

  const asked = req.nextUrl.searchParams.get('date')
  const ymd = asked && YMD.test(asked) ? asked : pacificYmd(0)
  return NextResponse.json(await yardBoardFor(ymd))
}
