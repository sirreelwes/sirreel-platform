/**
 * GET /api/scheduling/readiness?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The paperwork meter on the gantt bars (Wes 2026-09-09): five checks per
 * JOB — COI · agreement · card · driver · gear — keyed by job id so the
 * board can draw a filling rail on every bar the job owns.
 *
 * It is a SEPARATE call from /api/timeline-native on purpose. Gathering the
 * inputs costs ~1s for a 140-job window (four round trips, one of them over
 * every order, booking, item and assignment on those jobs), and the board
 * must not wait on a decoration to paint its bars. The gantt fires this
 * alongside the timeline fetch and the meters appear a beat later.
 *
 * Scoped to bars that have NOT finished: a paperwork meter on a rental that
 * came back in July is history, not work.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireReadSession } from '@/lib/scheduling/requireReadSession'
import { readinessForJobs } from '@/lib/jobs/readinessBatch'

export const dynamic = 'force-dynamic'

function parseYmd(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return isNaN(d.getTime()) ? null : d
}

export async function GET(req: NextRequest) {
  const denied = await requireReadSession()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // Same window defaults and the same 365-day clamp as /api/timeline-native,
  // so the two calls cover the same set of bars.
  const defaultFrom = new Date(today); defaultFrom.setDate(defaultFrom.getDate() - 14)
  const defaultTo = new Date(today); defaultTo.setDate(defaultTo.getDate() + 45)
  const minAllowed = new Date(today); minAllowed.setDate(minAllowed.getDate() - 365)
  const maxAllowed = new Date(today); maxAllowed.setDate(maxAllowed.getDate() + 365)
  const clamp = (d: Date) => (d < minAllowed ? minAllowed : d > maxAllowed ? maxAllowed : d)
  const fromParam = parseYmd(searchParams.get('from'))
  const toParam = parseYmd(searchParams.get('to'))
  const from = fromParam ? clamp(fromParam) : defaultFrom
  const to = toParam ? clamp(toParam) : defaultTo

  // Job ids only — the heavy hydration happens once, inside
  // readinessForJobs, for the DISTINCT jobs rather than per bar.
  // endDate >= today drops the finished bars; a booking still running is
  // in scope even if it started before the window.
  const rows = await prisma.booking.findMany({
    where: {
      startDate: { lte: to },
      endDate: { gte: from < today ? today : from },
      status: { not: 'CANCELLED' },
      jobId: { not: null },
    },
    select: { jobId: true },
  })

  const readiness = Object.fromEntries(
    await readinessForJobs(rows.map((r) => r.jobId as string)),
  )
  return NextResponse.json({ ok: true, readiness })
}
