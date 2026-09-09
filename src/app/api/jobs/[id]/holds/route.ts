import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getJobHoldInventory, releaseJobHolds } from '@/lib/jobs/holdInventory'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/jobs/[id]/holds — what this job is actually holding.
 *
 * Both halves in one payload: our own booking items (with the units
 * assigned to them) and the partners' sub-rentals (with whose unit it is
 * and whether releasing emails them). The release UI reads this to show a
 * human exactly what they are about to hand back BEFORE they confirm —
 * the whole reason a "release everything" button is safe to have.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id || null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const inventory = await getJobHoldInventory(id)
  if (!inventory) return NextResponse.json({ error: 'job not found' }, { status: 404 })
  return NextResponse.json(inventory)
}

/**
 * POST /api/jobs/[id]/holds  { bookingItemIds?: string[], subRentalIds?: string[] }
 *
 * Release the named holds and nothing else. Deliberately id-driven rather
 * than "release everything on this job": the partial case is the normal
 * one (Wes 2026-09-08 — "they could release the restroom trailer and not
 * the motorhome"), and a whole-job release is just the client sending
 * every id. An id outside this job is skipped and named in `skipped`,
 * never acted on.
 *
 * Independent of mark-lost on purpose. A production dropping one unit is
 * not a lost job, and a lost job is not always a release (the client may
 * have already been billed for the window).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id || null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    bookingItemIds?: unknown
    subRentalIds?: unknown
  }
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

  const bookingItemIds = ids(body.bookingItemIds)
  const subRentalIds = ids(body.subRentalIds)
  if (bookingItemIds.length === 0 && subRentalIds.length === 0) {
    return NextResponse.json(
      { error: 'nothing selected — pass bookingItemIds and/or subRentalIds' },
      { status: 400 },
    )
  }

  const inventory = await getJobHoldInventory(id)
  if (!inventory) return NextResponse.json({ error: 'job not found' }, { status: 404 })

  const result = await releaseJobHolds(id, { bookingItemIds, subRentalIds }, userId)
  if (result.error) {
    return NextResponse.json({ ...result, error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true, ...result })
}
