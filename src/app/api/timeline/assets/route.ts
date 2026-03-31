import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const [assets, maintenance] = await Promise.all([
      prisma.asset.findMany({
        where: { isActive: true },
        select: { id: true, unitName: true, categoryId: true, status: true, make: true, year: true },
        orderBy: { unitName: 'asc' },
      }),
      prisma.maintenanceRecord.findMany({
        where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
        select: { id: true, unitName: true, title: true, startDate: true, endDate: true, status: true },
      }),
    ]);

    return NextResponse.json({ ok: true, assets, maintenance });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
