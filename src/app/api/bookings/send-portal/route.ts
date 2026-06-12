import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { portalTokenUrl, clientTokenUrl } from '@/lib/portal/portalUrl'

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
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

    const portalUrl = portalTokenUrl(request!.token)
    const clientUrl = clientTokenUrl(request!.token)

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
