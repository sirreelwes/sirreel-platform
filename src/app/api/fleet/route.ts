import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const categoryId = searchParams.get('categoryId')
    const status = searchParams.get('status')

    const assets = await prisma.asset.findMany({
      where: {
        isActive: true,
        // Fleet is VEHICLE maintenance only — display filter. Studio/stage
        // assets (department=STAGES, e.g. the "Studios" category) stay fully
        // intact in the DB and bookable via the reservations/availability
        // system; they're just not vehicles, so they don't belong on Fleet.
        // This is a read-only SELECT filter — zero effect on booking.
        category: { department: 'VEHICLES' },
        ...(categoryId ? { categoryId } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: {
        category: { select: { id: true, name: true } },
        bookingAssignments: {
          where: {
            status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
            startDate: { lte: new Date() },
            endDate: { gte: new Date() },
          },
          include: {
            bookingItem: {
              include: {
                booking: {
                  include: {
                    company: { select: { name: true } },
                    agent: { select: { name: true } },
                  }
                }
              }
            }
          },
          take: 1,
        },
        maintenanceRecords: {
          where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { description: true, status: true },
        }
      },
      orderBy: [
        { category: { name: 'asc' } },
        { unitName: 'asc' }
      ]
    })

    const categories = await prisma.assetCategory.findMany({
      where: { department: 'VEHICLES', assets: { some: { isActive: true } } },
      select: { id: true, name: true, _count: { select: { assets: true } } },
      orderBy: { name: 'asc' }
    })

    // Latest BIT inspection date per unit (max inspectionDate) for the DOT
    // at-a-glance. The PDF itself loads lazily through the gated proxy.
    const latestBits = await prisma.bitInspection.groupBy({
      by: ['assetId'],
      _max: { inspectionDate: true },
    })
    const latestBitByAsset = new Map(latestBits.map((b) => [b.assetId, b._max.inspectionDate]))

    // Compute status counts — vehicles only, so the ALL/AVAILABLE/MAINT
    // tallies match the (vehicle-only) list above.
    const statusCounts = await prisma.asset.groupBy({
      by: ['status'],
      where: { isActive: true, category: { department: 'VEHICLES' } },
      _count: { id: true }
    })

    return NextResponse.json({
      ok: true,
      assets: assets.map(a => ({
        id: a.id,
        unitName: a.unitName,
        status: a.status,
        location: a.location,
        year: a.year,
        make: a.make,
        model: a.model,
        mileage: a.mileage,
        vin: a.vin,
        licensePlate: a.licensePlate,
        latestBitDate: latestBitByAsset.get(a.id) ?? null,
        notes: a.notes,
        categoryId: a.categoryId,
        categoryName: a.category.name,
        currentBooking: a.bookingAssignments[0] ? {
          company: a.bookingAssignments[0].bookingItem.booking.company?.name,
          agent: a.bookingAssignments[0].bookingItem.booking.agent?.name,
          endDate: a.bookingAssignments[0].endDate,
        } : null,
        maintenanceNote: a.maintenanceRecords[0]?.description || null,
      })),
      categories,
      statusCounts: Object.fromEntries(statusCounts.map(s => [s.status, s._count.id]))
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  try {
    const body = await req.json()
    const { assetId, status, notes, year, make, model, vin, licensePlate } = body
    if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })

    // DOT vehicle fields. year coerces to int (null clears); strings trim to
    // null when blank. VIN is stored as-is — validation is advisory only
    // (warn in the UI), never a hard block, since legacy/odd VINs exist.
    const trimOrNull = (v: unknown) => {
      if (v === undefined) return undefined
      const s = String(v ?? '').trim()
      return s.length ? s : null
    }
    const yearVal =
      year === undefined ? undefined : year === null || year === '' ? null : Number.isFinite(Number(year)) ? Math.trunc(Number(year)) : undefined

    const asset = await prisma.asset.update({
      where: { id: assetId },
      data: {
        ...(status ? { status: status as any } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(yearVal !== undefined ? { year: yearVal } : {}),
        ...(make !== undefined ? { make: trimOrNull(make) } : {}),
        ...(model !== undefined ? { model: trimOrNull(model) } : {}),
        ...(vin !== undefined ? { vin: trimOrNull(vin) } : {}),
        ...(licensePlate !== undefined ? { licensePlate: trimOrNull(licensePlate) } : {}),
      }
    })

    return NextResponse.json({ ok: true, asset })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
