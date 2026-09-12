import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { countPaperworkReviewQueue } from '@/lib/paperwork/reviewQueue'

export const dynamic = 'force-dynamic'

/**
 * GET /api/paperwork/review-queue — the Paperwork nav badge.
 *
 * How much client paperwork is waiting on a human: certificates nobody has
 * ruled on (or that carry a named-insured mismatch) and client redlines
 * sitting PENDING on the review desk. Skipped rows are excluded — see
 * src/lib/paperwork/reviewQueue.ts for what a skip does and does not mean.
 *
 * Same derivation the /admin/paperwork feed renders, so the badge and the
 * page always agree.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const counts = await countPaperworkReviewQueue()
  return NextResponse.json({ ok: true, count: counts.total, breakdown: counts })
}
