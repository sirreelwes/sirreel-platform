import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { syncRwQuotes } from '@/lib/rentalworks/syncQuotes'
import { reportRwSyncFailure } from '@/lib/rentalworks/syncAlert'
import { isRwAuthError } from '@/lib/rentalworks/rwClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/rw-quote-sync — the RentalWorks QUOTE mirror.
 *
 * Split out of /api/admin/rw-invoice-sync on 2026-09-03. It rode along
 * there since 2026-08-22 and could not possibly finish: the invoice pull
 * spends ~35s of the shared 300s first, and the quote pull alone was
 * MEASURED at 331.9s (RW's quote endpoint slows with pagination depth —
 * 4.8s for page 1, 31s by page 14). It was killed mid-await every single
 * night, committing nothing and logging nothing, and the mirror sat
 * frozen from 2026-08-22 until someone went looking twelve days later.
 *
 * Two things make that non-repeatable. The pull is resumable now, so a
 * run that reaches its budget advances a cursor instead of losing its
 * work — several runs close one cycle if that is what it takes. And a
 * failure raises a real alert instead of a console line nobody reads.
 *
 * Runs more often than daily on purpose: a cycle that needs two or three
 * passes should still close within a few hours, not a few days.
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://hq.sirreel.com/api/cron/rw-quote-sync
 */

/** Leave headroom under maxDuration: the pager only checks its budget
 *  BETWEEN pages, and RW's slowest observed quote page is ~47s. */
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
    const result = await syncRwQuotes({ budgetMs: BUDGET_MS })
    if (!result.ok) {
      console.error('[rw-quote-sync] failed:', result.error)
      await reportRwSyncFailure(result.error ?? 'unknown error', 'quote')
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
    console.error('[rw-quote-sync] threw:', e)
    await reportRwSyncFailure(reason, 'quote')
    return NextResponse.json({ ok: false, error: reason }, { status: 502 })
  }
}
