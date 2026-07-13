import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { ensureStagePaperworkRequest } from '@/lib/paperwork/ensureStagePaperworkRequest'

export const dynamic = 'force-dynamic'

/**
 * POST /api/paperwork/stage-requests/ensure  { bookingId }
 *
 * Explicit agent action: land a held stage booking in the stage-terms
 * workflow by find-or-creating its PaperworkRequest (see
 * ensureStagePaperworkRequest for the rules). Idempotent — double
 * clicks return the same request. Never touches the booking/hold.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    if (!body.bookingId || typeof body.bookingId !== 'string') {
      return NextResponse.json({ error: 'bookingId required' }, { status: 400 })
    }
    const result = await ensureStagePaperworkRequest(body.bookingId)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[paperwork/stage-requests/ensure]', err)
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
