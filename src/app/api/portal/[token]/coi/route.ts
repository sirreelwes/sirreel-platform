import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyHqDocument } from '@/lib/email/notifyHqDocument'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await (prisma as any).paperworkRequest.findUnique({ where: { token: params.token } })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const expiry = formData.get('expiry') as string | null
    let fileUrl = ''
    let buffer: Buffer | null = null
    if (file) {
      const bytes = await file.arrayBuffer()
      buffer = Buffer.from(bytes)
      fileUrl = `data:${file.type};base64,${buffer.toString('base64')}`
    }
    await (prisma as any).paperworkRequest.update({ where: { token: params.token }, data: { coiFileUrl: fileUrl, coiExpiryDate: expiry ? new Date(expiry) : null, coiUploadedAt: new Date(), coiReceived: true } })
    await prisma.booking.update({ where: { id: request.bookingId }, data: { coiReceived: true } })

    // hq@ gets the certificate. This route stored it as a base64 data URI on
    // the paperwork row and notified nobody — the ONLY copy lived in a column
    // nothing surfaces. Fire-and-forget; the row above is already committed.
    if (file && buffer) {
      const booking = await prisma.booking.findUnique({
        where: { id: request.bookingId },
        select: {
          jobId: true,
          jobName: true,
          bookingNumber: true,
          company: { select: { name: true } },
        },
      })
      notifyHqDocument({
        kind: 'coi',
        companyName: booking?.company?.name ?? null,
        jobName: booking?.jobName ?? null,
        rows: [
          { label: 'Job', value: booking?.jobName || '—' },
          { label: 'Company', value: booking?.company?.name || '—' },
          { label: 'Booking', value: booking?.bookingNumber || '—' },
          { label: 'File', value: `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)` },
          { label: 'Policy expiry', value: expiry || '—' },
          { label: 'Source', value: 'Client paperwork portal' },
        ],
        document: { filename: file.name || 'coi.pdf', content: buffer },
        href: booking?.jobId ? `${APP_URL}/jobs/${booking.jobId}#coi` : undefined,
        replyTo: request.sentTo || undefined,
        label: 'portal/token',
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
