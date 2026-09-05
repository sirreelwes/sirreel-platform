/**
 * POST /api/public/vendor/[token]/origin — the partner says where units
 * leave from. `lotAddress` writes Vendor.lotAddress (theirs, every booking);
 * `originAddress` writes this booking's override ('' clears it).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token
  if (!token || token.length < 32) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const sub = await prisma.subRental.findFirst({ where: { vendorToken: token }, select: { id: true, vendorId: true, originAddress: true, vendor: { select: { lotAddress: true } } } })
  if (!sub) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : undefined)
  const lotAddress = clean(body.lotAddress, 300)
  const originAddress = clean(body.originAddress, 300)

  if (lotAddress !== undefined && lotAddress !== sub.vendor.lotAddress) {
    await prisma.vendor.update({ where: { id: sub.vendorId }, data: { lotAddress } })
    await prisma.auditLog.create({
      data: { action: 'vendor.lot_address_updated', entityType: 'Vendor', entityId: sub.vendorId, oldValues: { lotAddress: sub.vendor.lotAddress }, newValues: { lotAddress, via: 'vendor-page', viaSubRentalId: sub.id } },
    })
  }
  if (originAddress !== undefined && originAddress !== sub.originAddress) {
    await prisma.subRental.update({ where: { id: sub.id }, data: { originAddress } })
    await prisma.auditLog.create({
      data: { action: 'sub_rental.origin_updated', entityType: 'SubRental', entityId: sub.id, oldValues: { originAddress: sub.originAddress }, newValues: { originAddress, via: 'vendor-page' } },
    })
  }
  const fresh = await prisma.subRental.findUnique({ where: { id: sub.id }, select: { originAddress: true, vendor: { select: { lotAddress: true } } } })
  return NextResponse.json({ ok: true, lotAddress: fresh?.vendor.lotAddress ?? null, originAddress: fresh?.originAddress ?? null })
}
