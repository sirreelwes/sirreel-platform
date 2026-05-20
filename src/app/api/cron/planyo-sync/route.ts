import { NextRequest, NextResponse } from 'next/server'
import { syncPlanyoToReservations } from '@/lib/planyo/syncReservations'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/planyo-sync
 *
 * Vercel Cron — one-way sync from Planyo `list_reservations` into the
 * native `reservations` table. See src/lib/planyo/syncReservations.ts
 * for the link-resolution logic.
 *
 * Auth: same `CRON_SECRET` Bearer pattern as the other crons in
 * vercel.json (health-check, cadence, follow-ups). Open in dev when
 * CRON_SECRET is unset so it's curl-able from localhost.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncPlanyoToReservations()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}
