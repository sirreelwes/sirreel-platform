import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { syncRwOrderRefs } from '@/lib/rentalworks/orderRef'
import { reportRwSyncFailure } from '@/lib/rentalworks/syncAlert'
import { isRwAuthError } from '@/lib/rentalworks/rwClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/rw-order-refs — the RentalWorks ORDER mirror.
 *
 * New on 2026-09-03. RwOrderRef had NO schedule at all — its only
 * refresh path was a fire-and-forget `warmRwOrderRefsInBackground()`
 * fired from the by-number route on a cache miss, and Vercel freezes a
 * function once its response is sent, so a scan measured at ~294s was
 * killed within milliseconds every time. The mirror only ever moved when
 * somebody ran it by hand, and was 12 days stale when found.
 *
 * The scan is resumable now, so a run that reaches its budget advances a
 * cursor rather than losing its work, and a failure raises a real alert.
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://hq.sirreel.com/api/cron/rw-order-refs
 */

/** Leave headroom under maxDuration: the pager only checks its budget
 *  BETWEEN pages, and an order/browse page carries 500 rows. */
const BUDGET_MS = 210_000

function viaCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: allow manual curl
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!viaCron(req)) {
    const session = await getServerSession()
    if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncRwOrderRefs({ budgetMs: BUDGET_MS })
    if (!result.ok) {
      console.error('[rw-order-refs] failed:', result.error)
      await reportRwSyncFailure(result.error ?? 'unknown error', 'orderRef')
      return NextResponse.json(result, { status: 502 })
    }
    // An incomplete cycle is NOT a failure — it is the design. Say so in
    // the response so a human reading it manually can see progress.
    return NextResponse.json({
      ...result,
      note: result.complete
        ? 'cycle complete'
        : `budget reached — next run resumes at page ${result.nextPage}`,
    })
  } catch (e) {
    // A dead credential reaches here (the pager rethrows it deliberately).
    const reason = isRwAuthError(e)
      ? `RentalWorks rejected the token — rotate it: docs/runbooks/rentalworks-token-rotation.md`
      : `${(e as Error).name}: ${(e as Error).message}`
    console.error('[rw-order-refs] threw:', e)
    await reportRwSyncFailure(reason, 'orderRef')
    return NextResponse.json({ ok: false, error: reason }, { status: 502 })
  }
}
