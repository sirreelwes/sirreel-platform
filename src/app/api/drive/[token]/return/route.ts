import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { completeSelfReturn, SelfReturnError } from '@/lib/drivers/selfReturn'

export const dynamic = 'force-dynamic'

/**
 * POST /api/drive/[token]/return — the driver drops the vehicle off on an
 * UNATTENDED return. The mirror of ../checkout.
 *
 * Body: {
 *   mileage?: number | null        — odometer reading on return
 *   fuelLevel?: string | null      — full / 3/4 / 1/2 / 1/4 / empty
 *   damageNoted?: boolean          — "I can see new damage"
 *   notes?: string | null
 *   stagedPhotos: { key, filename?, contentType?, position? }[]
 *     (staged through ../checkout/photo — same prefix, same slots)
 * }
 *
 * Only allowed on a blind return — a staffed return is received by the
 * person at the yard, on the fleet screens. Everything else (four sides
 * on file, mileage or odometer shot, driver holds the vehicle) is
 * enforced in completeSelfReturn, which owns the write.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const da = await prisma.driverAssignment.findUnique({
    where: { token },
    select: {
      id: true,
      bookingAssignment: {
        select: { bookingItem: { select: { booking: { select: { jobId: true } } } } },
      },
    },
  })
  if (!da) return NextResponse.json({ error: 'invalid link' }, { status: 404 })

  // The ORDER says whether the return is unattended. Re-read here rather
  // than trusted from the client.
  const jobId = da.bookingAssignment.bookingItem.booking.jobId
  const blind = jobId
    ? await prisma.order.findFirst({
        where: { jobId, status: { not: 'CANCELLED' }, blindReturn: true },
        select: { id: true },
      })
    : null
  if (!blind) {
    return NextResponse.json(
      { error: 'This return is staffed — SirReel will check the vehicle in with you at the yard.' },
      { status: 409 },
    )
  }

  const body = (await req.json().catch(() => null)) as {
    mileage?: number | string | null
    fuelLevel?: string | null
    damageNoted?: boolean
    notes?: string | null
    stagedPhotos?: { key?: string; filename?: string | null; contentType?: string | null; position?: string | null }[]
  } | null
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 })

  const mileageRaw = body.mileage
  const mileage =
    mileageRaw != null && mileageRaw !== '' && Number.isFinite(Number(mileageRaw)) ? Number(mileageRaw) : null

  try {
    const result = await completeSelfReturn({
      driverAssignmentId: da.id,
      mileage,
      fuelLevel: body.fuelLevel ? String(body.fuelLevel) : null,
      damageNoted: !!body.damageNoted,
      notes: typeof body.notes === 'string' ? body.notes : null,
      stagedPhotos: Array.isArray(body.stagedPhotos) ? body.stagedPhotos : [],
    })
    return NextResponse.json({ ok: true, ...result }, { status: 201 })
  } catch (e) {
    if (e instanceof SelfReturnError) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    }
    console.error('[drive/return] failed', e)
    return NextResponse.json({ error: 'Could not record the return. Please try again or call us.' }, { status: 500 })
  }
}
