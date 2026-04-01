import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const bookings = await prisma.booking.findMany({
      where: { rentalworksOrderId: null },
      include: {
        company: { select: { name: true } },
        person: { select: { firstName: true, lastName: true, email: true } },
        agent: { select: { firstName: true, lastName: true } },
        paperworkRequests: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: {
            token: true,
            contractType: true,
            rentalAgreement: true,
            lcdwAccepted: true,
            coiReceived: true,
            creditCardAuth: true,
            studioContractSigned: true,
            sentAt: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return NextResponse.json({ bookings });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
