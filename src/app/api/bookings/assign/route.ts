import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { bookingItemId, assetId } = await req.json();
    if (!bookingItemId || !assetId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const item = await prisma.bookingItem.findUnique({
      where: { id: bookingItemId },
      include: { booking: true }
    });
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

    const assignment = await prisma.bookingAssignment.create({
      data: {
        bookingItemId,
        assetId,
        startDate: item.booking.startDate,
        endDate: item.booking.endDate,
        status: 'ASSIGNED',
      },
      include: { asset: true }
    });

    return NextResponse.json({ ok: true, assignment });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
