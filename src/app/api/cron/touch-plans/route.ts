/**
 * GET /api/cron/touch-plans — advance every active sequence.
 *
 * Scheduled daily. Safe to call more than once: TouchPlanSend is unique
 * on (enrollment, step), so a double fire cannot re-send a step, and the
 * runner only ever advances ONE step per enrolment per run.
 *
 * Authorized by CRON_SECRET the same way the other cron routes are.
 * Without it this is an endpoint that makes the app send email on demand.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runTouchPlans } from '@/lib/outreach/touchPlanRunner'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await runTouchPlans()
  console.log('[cron/touch-plans]', JSON.stringify(result))
  return NextResponse.json({ ok: true, ...result })
}
