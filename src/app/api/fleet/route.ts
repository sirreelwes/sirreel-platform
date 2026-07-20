import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { AssetStatus } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'

// Full lifecycle vocabulary. Terminal statuses take a unit OUT of fleet:
// the PATCH below forces isActive=false for them (and true for the rest) so
// the two out-of-fleet signals — Asset.status and Asset.isActive — can never
// drift. Assets are NEVER hard-deleted; the Inactive scope keeps history
// viewable and a unit can be reactivated (back to AVAILABLE).
const ALL_STATUSES: readonly AssetStatus[] = [
  'AVAILABLE', 'BOOKED', 'MAINTENANCE', 'IN_TRANSIT', 'WAREHOUSE',
  'RETIRED', 'SOLD', 'STOLEN', 'TOTALED',
]
const TERMINAL_STATUSES: readonly AssetStatus[] = ['RETIRED', 'SOLD', 'STOLEN', 'TOTALED']

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const categoryId = searchParams.get('categoryId')
    const status = searchParams.get('status')
    // scope=inactive → the out-of-fleet view (terminal-status units).
    const inactiveScope = searchParams.get('scope') === 'inactive'

    const assets = await prisma.asset.findMany({
      where: {
        isActive: !inactiveScope,
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
        category: { select: { id: true, name: true, imageUrl: true } },
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
    // tallies match the (vehicle-only) list above. Counts follow the scope.
    const statusCounts = await prisma.asset.groupBy({
      by: ['status'],
      where: { isActive: !inactiveScope, category: { department: 'VEHICLES' } },
      _count: { id: true }
    })
    // Out-of-fleet tally for the Inactive tab badge (always the flip side).
    const inactiveCount = await prisma.asset.count({
      where: { isActive: false, category: { department: 'VEHICLES' } },
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
        accessCode: a.accessCode,
        latestBitDate: latestBitByAsset.get(a.id) ?? null,
        notes: a.notes,
        categoryId: a.categoryId,
        categoryName: a.category.name,
        // The panel + fleet list show the category-generic picture through the
        // session-gated per-asset proxy; this flag says whether one exists
        // (the raw private-blob URL is never sent to the client).
        categoryHasImage: Boolean(a.category.imageUrl),
        currentBooking: a.bookingAssignments[0] ? {
          company: a.bookingAssignments[0].bookingItem.booking.company?.name,
          agent: a.bookingAssignments[0].bookingItem.booking.agent?.name,
          endDate: a.bookingAssignments[0].endDate,
        } : null,
        maintenanceNote: a.maintenanceRecords[0]?.description || null,
      })),
      categories,
      statusCounts: Object.fromEntries(statusCounts.map(s => [s.status, s._count.id])),
      inactiveCount,
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
    const { assetId, status, notes, year, make, model, vin, licensePlate, accessCode } = body
    if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })

    // Lifecycle status writes are a FLEET action (canAssignAssets) and must be
    // a real AssetStatus value (the old `status as any` cast let arbitrary
    // strings through — e.g. the retired 'INACTIVE' button 500ed).
    if (status !== undefined) {
      if (!ALL_STATUSES.includes(status as AssetStatus)) {
        return NextResponse.json({ error: `status must be one of ${ALL_STATUSES.join(' | ')}` }, { status: 400 })
      }
      const actor = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { role: true },
      })
      if (!actor || !can(actor.role, 'canAssignAssets')) {
        return NextResponse.json(
          { error: 'forbidden', reason: 'changing a unit lifecycle status is a fleet action' },
          { status: 403 },
        )
      }
    }

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
        // Status + isActive move together: terminal → out of fleet
        // (isActive=false, drops off the default list + reservations board);
        // any non-terminal set (incl. reactivate → AVAILABLE) brings it back.
        ...(status
          ? { status: status as AssetStatus, isActive: !TERMINAL_STATUSES.includes(status as AssetStatus) }
          : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(yearVal !== undefined ? { year: yearVal } : {}),
        ...(make !== undefined ? { make: trimOrNull(make) } : {}),
        ...(model !== undefined ? { model: trimOrNull(model) } : {}),
        ...(vin !== undefined ? { vin: trimOrNull(vin) } : {}),
        ...(licensePlate !== undefined ? { licensePlate: trimOrNull(licensePlate) } : {}),
        ...(accessCode !== undefined ? { accessCode: trimOrNull(accessCode) } : {}),
      }
    })

    return NextResponse.json({ ok: true, asset })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
