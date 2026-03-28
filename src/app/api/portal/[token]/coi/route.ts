import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await (prisma as any).paperworkRequest.findUnique({ where: { token: params.token } })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const expiry = formData.get('expiry') as string | null
    let fileUrl = ''
    if (file) {
      const bytes = await file.arrayBuffer()
      fileUrl = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`
    }
    await (prisma as any).paperworkRequest.update({ where: { token: params.token }, data: { coiFileUrl: fileUrl, coiExpiryDate: expiry ? new Date(expiry) : null, coiUploadedAt: new Date(), coiReceived: true } })
    await prisma.booking.update({ where: { id: request.bookingId }, data: { coiReceived: true } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
