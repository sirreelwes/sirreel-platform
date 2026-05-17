import { NextRequest, NextResponse } from 'next/server'
import { runDueCadenceEvents } from '@/lib/cadence/runner'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/cadence
 *
 * Scheduled every 15 minutes via vercel.json. Pulls every due CadenceEvent
 * (scheduledFor <= now, not yet executed, not skipped) and dispatches it
 * through src/lib/cadence/runner. Safety gates (CANCELLED orders, manual
 * override, paused) live in the runner so manual invocations also honor them.
 *
 * Vercel Cron auth: passes Authorization: Bearer ${CRON_SECRET}. When the
 * env var is not set (local manual runs), the route is open — matches the
 * pattern used by /api/cron/follow-ups.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const summary = await runDueCadenceEvents()
  return NextResponse.json({ ok: true, ...summary })
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}
