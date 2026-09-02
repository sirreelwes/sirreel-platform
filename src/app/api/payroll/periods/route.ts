/**
 * Pay periods — list and create.
 *
 * Payroll-allowlisted on BOTH verbs including the read: hours are
 * compensation data, and a GET that leaks the whole crew's schedule is as bad
 * as a POST that edits it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePayrollAccess } from '@/lib/payroll/access'
import { defaultPeriod, toIsoDay, utcDay } from '@/lib/payroll/period'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await requirePayrollAccess()
  if (me instanceof NextResponse) return me

  const periods = await prisma.payPeriod.findMany({
    orderBy: { startDate: 'desc' },
    include: { _count: { select: { entries: true } } },
  })

  return NextResponse.json({
    // What the "new period" button pre-fills — computed server-side so the
    // Sat-anchoring is decided in one place, not by the browser's clock.
    suggested: (() => {
      const { startDate, endDate } = defaultPeriod()
      return { startDate: toIsoDay(startDate), endDate: toIsoDay(endDate) }
    })(),
    periods: periods.map((p) => ({
      id: p.id,
      startDate: toIsoDay(p.startDate),
      endDate: toIsoDay(p.endDate),
      status: p.status,
      note: p.note,
      entryCount: p._count.entries,
      lockedAt: p.lockedAt?.toISOString() ?? null,
      exportedAt: p.exportedAt?.toISOString() ?? null,
    })),
  })
}

export async function POST(req: NextRequest) {
  const me = await requirePayrollAccess()
  if (me instanceof NextResponse) return me

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const fallback = defaultPeriod()
  const startDate = body.startDate ? utcDay(String(body.startDate)) : fallback.startDate
  const endDate = body.endDate ? utcDay(String(body.endDate)) : fallback.endDate

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'invalid dates' }, { status: 400 })
  }
  if (endDate.getTime() < startDate.getTime()) {
    return NextResponse.json({ error: 'end date is before start date' }, { status: 400 })
  }

  // Overlap check. Two periods covering the same day would let the same
  // workday be keyed twice and exported twice — the unique (start,end) key
  // alone does not catch a period that merely overlaps.
  const overlap = await prisma.payPeriod.findFirst({
    where: { startDate: { lte: endDate }, endDate: { gte: startDate } },
    select: { id: true, startDate: true, endDate: true },
  })
  if (overlap) {
    return NextResponse.json({
      error: `overlaps the existing period ${toIsoDay(overlap.startDate)} – ${toIsoDay(overlap.endDate)}`,
    }, { status: 409 })
  }

  const created = await prisma.payPeriod.create({
    data: { startDate, endDate, note: body.note ? String(body.note) : null },
  })

  return NextResponse.json({
    id: created.id,
    startDate: toIsoDay(created.startDate),
    endDate: toIsoDay(created.endDate),
    status: created.status,
  }, { status: 201 })
}
