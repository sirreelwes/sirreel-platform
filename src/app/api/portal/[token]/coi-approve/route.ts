import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token }
    })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    const { approvedBy, note } = await req.json()

    await prisma.$executeRawUnsafe(
      `UPDATE paperwork_requests SET 
        coi_admin_approved=true,
        coi_admin_approved_by=$1,
        coi_admin_approval_note=$2,
        coi_admin_approved_at=$3,
        coi_received=true
      WHERE token=$4`,
      approvedBy || 'Admin',
      note || '',
      new Date(),
      params.token
    )

    await prisma.booking.update({
      where: { id: request.bookingId },
      data: { coiReceived: true }
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
