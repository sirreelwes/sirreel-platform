/**
 * POST /api/scheduling/holds — create a category-level hold.
 *
 * Chunk 4 of native-scheduling-v1-brief.md. Job-origination entry
 * point: agent picks a category + dates + quantity and an empty
 * Booking + BookingItem(status=REQUESTED) are persisted.
 *
 * Server-side capacity gate (re-runs even though the client may have
 * already checked) — the only place a hold can be created. Two
 * blocking modes per the brief:
 *
 *   1) Hard block (409, no override) — requested quantity exceeds
 *      available capacity:  qty > availableToHold
 *   2) Soft warn (409, requires `bufferOverride: true` to bypass) —
 *      we have capacity overall, but some of the units that would
 *      fulfill the hold are in buffer-encroachment:  qty > freeCount
 *      AND qty <= availableToHold
 *
 * The client surfaces (2) as a yellow override prompt and re-submits
 * with `bufferOverride=true` to force.
 *
 * No unit assignment happens here — that's Chunk 5.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCategoryAvailability } from '@/lib/scheduling/availability'
import { getServerSession } from 'next-auth'

export const dynamic = 'force-dynamic'

interface HoldBody {
  categoryId?: string
  startDate?: string // YYYY-MM-DD
  endDate?: string // YYYY-MM-DD
  quantity?: number
  companyId?: string
  personId?: string
  agentId?: string
  jobName?: string
  productionName?: string | null
  priority?: 'STANDARD' | 'HIGH' | 'LOW'
  source?: 'WEBSITE' | 'PHONE' | 'EMAIL' | 'AGENT_DIRECT' | 'AI_AUTO' | 'PLANYO_BACKFILL'
  notes?: string | null
  bufferDays?: number
  bufferOverride?: boolean
  /** Hold rank — 1 = primary (default, capacity-gated); ≥2 = backup,
   *  bypasses capacity and buffer checks. If isBackup=true and
   *  holdRank is omitted the server picks rank = (max existing rank
   *  in the window) + 1. */
  holdRank?: number
  isBackup?: boolean
}

function parseDate(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

async function nextBookingNumber(year: number): Promise<string> {
  // Monotonic suffix from this year's count. Race-tolerant via the
  // unique-constraint retry below.
  const yearStart = new Date(`${year}-01-01T00:00:00.000Z`)
  const count = await prisma.booking.count({ where: { createdAt: { gte: yearStart } } })
  return `SR-${year}-${String(count + 1).padStart(4, '0')}`
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as HoldBody | null
  if (!body) return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })

  const start = parseDate(body.startDate)
  const end = parseDate(body.endDate)
  const qty = Number.isFinite(body.quantity) ? Math.floor(body.quantity!) : 0
  const bufferDays = Number.isFinite(body.bufferDays) ? body.bufferDays! : 1

  if (!body.categoryId) return NextResponse.json({ error: 'categoryId required' }, { status: 400 })
  if (!start || !end) return NextResponse.json({ error: 'startDate and endDate (YYYY-MM-DD) required' }, { status: 400 })
  if (end < start) return NextResponse.json({ error: 'endDate must be >= startDate' }, { status: 400 })
  if (qty <= 0) return NextResponse.json({ error: 'quantity must be >= 1' }, { status: 400 })
  if (!body.companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })
  if (!body.personId) return NextResponse.json({ error: 'personId required' }, { status: 400 })
  if (!body.jobName?.trim()) return NextResponse.json({ error: 'jobName required' }, { status: 400 })

  // Resolve agentId — body, then session.
  let agentId = body.agentId
  if (!agentId) {
    const session = await getServerSession()
    if (session?.user?.email) {
      const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      if (u) agentId = u.id
    }
  }
  if (!agentId) return NextResponse.json({ error: 'agentId required (none in body or session)' }, { status: 400 })

  // Look up category for the dailyRate default; also confirms it exists.
  const category = await prisma.assetCategory.findUnique({
    where: { id: body.categoryId },
    select: { id: true, name: true, dailyRate: true },
  })
  if (!category) return NextResponse.json({ error: 'category not found' }, { status: 404 })

  // Determine effective rank. Default = 1 (primary). isBackup=true
  // without an explicit holdRank → server picks next-available rank
  // for the overlapping window.
  const explicitRank = Number.isFinite(body.holdRank) ? Math.max(1, Math.floor(body.holdRank!)) : null
  const wantsBackup = body.isBackup === true || (explicitRank !== null && explicitRank >= 2)
  let effectiveRank = explicitRank ?? 1
  if (wantsBackup && !explicitRank) {
    const maxRankAgg = await prisma.bookingItem.aggregate({
      where: {
        categoryId: body.categoryId,
        status: { in: ['REQUESTED', 'ASSIGNED'] },
        booking: { startDate: { lte: end }, endDate: { gte: start } },
      },
      _max: { holdRank: true },
    })
    effectiveRank = Math.max(2, (maxRankAgg._max.holdRank ?? 1) + 1)
  }
  const isPrimary = effectiveRank === 1

  // Re-check availability server-side — this is the capacity gate
  // for PRIMARY holds. Backups (rank ≥ 2) skip it entirely: they're
  // explicitly allowed to overlap at-capacity categories and queue.
  const availability = await getCategoryAvailability(body.categoryId, start, end, bufferDays)

  if (isPrimary && qty > availability.availableToHold) {
    return NextResponse.json(
      {
        ok: false,
        error: 'over-capacity',
        reason: 'requested quantity exceeds availableToHold',
        suggestion: 'place a backup hold (rank ≥ 2) — backups queue behind the primary and convert when the primary releases',
        availability: {
          serviceableCount: availability.serviceableCount,
          freeCount: availability.freeCount,
          bufferCount: availability.bufferCount,
          bookedCount: availability.bookedCount,
          availableToHold: availability.availableToHold,
        },
      },
      { status: 409 },
    )
  }

  if (isPrimary && qty > availability.freeCount && !body.bufferOverride) {
    return NextResponse.json(
      {
        ok: false,
        error: 'buffer-encroachment',
        reason:
          `${qty} requested but only ${availability.freeCount} fully-free unit(s); ` +
          `fulfilling will draw on ${qty - availability.freeCount} buffer-encroached unit(s). ` +
          `Resubmit with bufferOverride=true to proceed.`,
        needsOverride: true,
        availability: {
          serviceableCount: availability.serviceableCount,
          freeCount: availability.freeCount,
          bufferCount: availability.bufferCount,
          bookedCount: availability.bookedCount,
          availableToHold: availability.availableToHold,
        },
      },
      { status: 409 },
    )
  }

  // Persist atomically. Tiny retry loop on bookingNumber unique
  // collision (two concurrent holds in the same second).
  const year = new Date().getUTCFullYear()
  let attempt = 0
  while (true) {
    attempt++
    const bookingNumber = await nextBookingNumber(year)
    try {
      const result = await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.create({
          data: {
            bookingNumber,
            companyId: body.companyId!,
            personId: body.personId!,
            agentId: agentId!,
            jobName: body.jobName!.trim(),
            productionName: body.productionName?.trim() || null,
            startDate: start,
            endDate: end,
            status: 'REQUEST',
            priority: body.priority ?? 'STANDARD',
            source: body.source ?? 'AGENT_DIRECT',
            notes: body.notes?.trim() || null,
          },
          select: { id: true, bookingNumber: true, jobName: true, startDate: true, endDate: true },
        })
        const bookingItem = await tx.bookingItem.create({
          data: {
            bookingId: booking.id,
            categoryId: body.categoryId!,
            quantity: qty,
            dailyRate: category.dailyRate,
            status: 'REQUESTED',
            holdRank: effectiveRank,
          },
          select: { id: true, quantity: true, status: true, dailyRate: true, holdRank: true },
        })
        return { booking, bookingItem }
      })

      return NextResponse.json(
        {
          ok: true,
          booking: result.booking,
          bookingItem: result.bookingItem,
          bufferOverrideUsed: Boolean(body.bufferOverride && qty > availability.freeCount && isPrimary),
          isBackup: !isPrimary,
          holdRank: effectiveRank,
        },
        { status: 201 },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt < 3 && /Unique constraint.*booking_number/i.test(msg)) {
        // Retry with a fresh number — the count() result raced us.
        continue
      }
      console.error('[scheduling/holds] create failed:', msg)
      return NextResponse.json({ error: 'create failed', detail: msg }, { status: 500 })
    }
  }
}
