import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { syncRwInvoices } from '@/lib/rentalworks/syncInvoices'
import { syncRwQuotes } from '@/lib/rentalworks/syncQuotes'
import { reportRwSyncFailure } from '@/lib/rentalworks/syncAlert'
import { isRwAuthError } from '@/lib/rentalworks/rwClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/rw-invoice-sync — refresh the RentalWorks invoice mirror.
 * Authed (staff session) OR CRON_SECRET bearer so it can be scheduled later.
 * GET returns mirror status without touching RW.
 */
export async function GET(req: NextRequest) {
  // Vercel Cron issues GET, so a cron-authorized GET runs the sync;
  // an ordinary staff GET just reports mirror status.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) {
    const result = await syncRwInvoices()
    if (!result.ok) {
      // A console.error and a 502 to Vercel's cron is what let this fail
      // nightly for over two weeks unnoticed. Raise something a human sees.
      console.error('[rw-invoice-sync cron] failed:', result.error)
      await reportRwSyncFailure(result.error ?? 'unknown error')
    }
    // Quotes ride along (2026-08-22) so RW quotes reach the reconcile
    // queue BEFORE their first invoice. Deliberately non-fatal: the
    // invoice mirror is the money-critical product; a quote-endpoint
    // hiccup must never 502 the cron or block the invoice pull.
    // Non-fatal EXCEPT for a dead credential: a quote-endpoint hiccup must
    // not 502 the cron, but folding RwAuthError in here would re-create
    // the exact swallow this goal removed one layer down.
    const quotes = await syncRwQuotes().catch((e) => {
      if (isRwAuthError(e) || (e as Error)?.name === 'RwNoCredentialError') throw e
      return { ok: false as const, pulled: 0, pages: 0, error: String(e) }
    })
    if (!quotes.ok) console.error('[rw-quote-sync cron] failed (non-fatal):', quotes.error)
    // No "expiring soon" warning: it was derived from the token's `exp`
    // claim, which RentalWorks does not enforce, so it fired on every run
    // regardless of how fresh the token was. Rotation is driven by the 401
    // alert above and the calendar reminder in the runbook.
    return NextResponse.json({ ...result, quotes }, { status: result.ok ? 200 : 502 })
  }
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [count, latest] = await Promise.all([
    prisma.rwInvoice.count(),
    prisma.rwInvoice.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
  ])
  return NextResponse.json({
    count,
    syncedAt: latest?.syncedAt ?? null,
    // No token expiry is reported. It came from the JWT `exp` claim, which RW
    // stamps at 300 seconds and does not enforce, so the page read "Lapsed"
    // permanently — including for tokens working fine. Mirror staleness above
    // is the honest signal.
  })
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  const viaCron = !!cronSecret && auth === `Bearer ${cronSecret}`
  if (!viaCron) {
    const session = await getServerSession()
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncRwInvoices()
  if (!result.ok) {
    console.error('[rw-invoice-sync] failed:', result.error)
    return NextResponse.json({ ...result }, { status: 502 })
  }
  // Quotes ride along — non-fatal (see the cron branch).
  // Non-fatal EXCEPT for a dead credential: a quote-endpoint hiccup must
  // not 502 the cron, but folding RwAuthError in here would re-create
  // the exact swallow this goal removed one layer down.
  const quotes = await syncRwQuotes().catch((e) => {
    if (isRwAuthError(e) || (e as Error)?.name === 'RwNoCredentialError') throw e
    return { ok: false as const, pulled: 0, pages: 0, error: String(e) }
  })
  if (!quotes.ok) console.error('[rw-quote-sync] failed (non-fatal):', quotes.error)
  return NextResponse.json({ ...result, quotes })
}
