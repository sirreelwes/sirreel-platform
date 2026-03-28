import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const { bookingId } = await req.json()
    if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 })

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { company: true, person: true, agent: true }
    })
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    // Check if one already exists
    const existing = await prisma.paperworkRequest.findFirst({
      where: { bookingId },
      orderBy: { sentAt: 'desc' }
    })

    let request = existing
    if (!existing) {
      request = await prisma.paperworkRequest.create({
        data: {
          bookingId,
          sentTo: booking.person?.email || '',
          sentAt: new Date(),
        }
      })
    }

    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://sirreel-fleet.vercel.app'}/portal/${request!.token}`
    const clientUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://sirreel-fleet.vercel.app'}/client/${request!.token}`

    return NextResponse.json({ 
      ok: true, 
      token: request!.token,
      portalUrl,
      clientUrl,
      existing: !!existing
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
