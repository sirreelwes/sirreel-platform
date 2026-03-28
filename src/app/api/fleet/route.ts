import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const categoryId = searchParams.get('categoryId')
    const status = searchParams.get('status')

    const assets = await prisma.asset.findMany({
      where: {
        isActive: true,
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
      where: { assets: { some: { isActive: true } } },
      select: { id: true, name: true, _count: { select: { assets: true } } },
      orderBy: { name: 'asc' }
    })

    // Compute status counts
    const statusCounts = await prisma.asset.groupBy({
      by: ['status'],
      where: { isActive: true },
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
  try {
    const { assetId, status, notes } = await req.json()
    if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })

    const asset = await prisma.asset.update({
      where: { id: assetId },
      data: {
        ...(status ? { status: status as any } : {}),
        ...(notes !== undefined ? { notes } : {}),
      }
    })

    return NextResponse.json({ ok: true, asset })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
