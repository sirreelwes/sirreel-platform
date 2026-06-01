/**
 * GET /api/cron/ach-poll
 *
 * Phase 6 commit 4 — scheduled poller for outstanding ACH payments.
 *
 * Cadence: scheduled a few times a day via vercel.json (recommended:
 * 6am / noon / 6pm Pacific). ACH settlement happens on a
 * business-day timer at the bank; sub-hour polling buys nothing and
 * burns gateway quota.
 *
 * Authorization: matches the existing cron pattern —
 * `Authorization: Bearer ${CRON_SECRET}` when set, open otherwise
 * (for local manual runs).
 *
 * DORMANCY GATE: the whole job no-ops when ACH_ENABLED is unset.
 * Card payments don't need polling (instant from auth+capture);
 * until ACH originations are allowed there are zero PENDING ACH
 * rows to scan and we don't want to make gateway calls anyway. Once
 * underwriting completes and ACH_ENABLED flips on, the same handler
 * runs without further code change.
 */

import { NextRequest, NextResponse } from 'next/server'
import { pollAchPayments } from '@/lib/cardpointe/achPollingJob'

export const dynamic = 'force-dynamic'
// ACH inquire calls can chain — 100 rows × ~300ms gateway latency
// keeps us inside the default Vercel function timeout, but bumping
// maxDuration gives headroom for the rare big batch.
export const maxDuration = 60

const ACH_ENABLED = process.env.ACH_ENABLED === 'true'

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!ACH_ENABLED) {
    // No-op. Flag returns the dormant state explicitly so the cron
    // dashboard reads "scheduled but inactive" rather than failing.
    return NextResponse.json({
      ok: true,
      dormant: true,
      reason: 'ACH_ENABLED not set — settlement polling is dormant pending CardPointe underwriting',
    })
  }
  const summary = await pollAchPayments()
  return NextResponse.json({ ok: true, ...summary })
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}
