/**
 * /api/drive/[token]/hours — a production's driver on OUR truck logs a day.
 * Same body and view as the partner-driver route; different anchor.
 *   GET            → { hours }
 *   POST   { workDate, startTime, endTime, breakMinutes?, notes? }
 *   DELETE { workDate }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteHours, listHours, upsertHours } from '@/lib/drivers/hoursStore'

export const dynamic = 'force-dynamic'

async function resolve(token: string) {
  const da = await prisma.driverAssignment.findUnique({
    where: { token },
    select: { id: true, status: true, expiresAt: true, bookingAssignment: { select: { startDate: true, endDate: true } } },
  })
  if (!da) return { error: NextResponse.json({ error: 'invalid link' }, { status: 404 }) }
  if (da.expiresAt && da.expiresAt < new Date()) return { error: NextResponse.json({ error: 'expired' }, { status: 410 }) }
  if (da.status === 'CANCELLED') return { error: NextResponse.json({ error: 'This assignment was cancelled.' }, { status: 409 }) }
  return {
    da,
    window: {
      startDate: da.bookingAssignment.startDate.toISOString().slice(0, 10),
      endDate: da.bookingAssignment.endDate.toISOString().slice(0, 10),
    },
  }
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const r = await resolve(params.token)
  if ('error' in r) return r.error
  return NextResponse.json({ ok: true, hours: await listHours({ driverAssignmentId: r.da.id }), window: r.window })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const r = await resolve(params.token)
  if ('error' in r) return r.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const res = await upsertHours({ driverAssignmentId: r.da.id }, body, r.window)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, hours: res.view })
}

export async function DELETE(req: NextRequest, { params }: { params: { token: string } }) {
  const r = await resolve(params.token)
  if ('error' in r) return r.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const view = await deleteHours({ driverAssignmentId: r.da.id }, body.workDate)
  if (!view) return NextResponse.json({ error: 'workDate required' }, { status: 400 })
  return NextResponse.json({ ok: true, hours: view })
}
