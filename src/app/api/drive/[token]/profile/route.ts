import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/drive/[token]/profile — the driver tells us who they are.
 *
 * An invite carries only an email, so until this runs the roster shows
 * whatever we guessed (often the email's local part) and dispatch has no
 * number to call when someone is late at the gate. This is the driver
 * filling that in themselves, which is both faster and more accurate than
 * an agent typing what they heard on the phone.
 *
 * Scoped by the assignment token; it writes to the DRIVER because a name
 * and a phone number belong to the person, not to one job.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const da = await prisma.driverAssignment.findUnique({
    where: { token },
    select: { id: true, driverId: true, expiresAt: true },
  })
  if (!da) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  if (da.expiresAt && da.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This link has expired.' }, { status: 410 })
  }

  const body = await req.json().catch(() => null)
  const firstName = String(body?.firstName ?? '').trim().slice(0, 80)
  const lastName = String(body?.lastName ?? '').trim().slice(0, 80)
  const phoneRaw = String(body?.phone ?? '').trim()

  if (!firstName) {
    return NextResponse.json({ error: 'Please enter your first name.' }, { status: 400 })
  }
  // Keep digits and a leading +; drop the formatting people type. Stored
  // as given otherwise — this is a number a dispatcher dials, not a key.
  const digits = phoneRaw.replace(/[^\d+]/g, '')
  if (phoneRaw && digits.replace(/\D/g, '').length < 10) {
    return NextResponse.json({ error: 'That phone number looks too short.' }, { status: 400 })
  }

  await prisma.driver.update({
    where: { id: da.driverId },
    data: {
      firstName,
      lastName,
      ...(phoneRaw ? { phone: digits.slice(0, 30) } : {}),
    },
  })
  return NextResponse.json({ ok: true })
}
