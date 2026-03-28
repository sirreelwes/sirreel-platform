import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get('orderId')
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  try {
    const booking = await prisma.booking.findFirst({
      where: { rentalworksOrderId: orderId },
      include: {
        company: true,
        person: true,
        agent: true,
        items: {
          include: {
            category: true,
            assignments: {
              include: { asset: true }
            }
          }
        },
        dispatchTasks: { orderBy: { createdAt: 'asc' } },
        insuranceClaims: true,
        paperworkRequests: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        }
      }
    })

    return NextResponse.json({ booking })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
