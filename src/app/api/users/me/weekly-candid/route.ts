/**
 * POST /api/users/me/weekly-candid — upload the session user's
 * "candid of the week". A new row is created each upload; the
 * current candid is the most-recent row for the user.
 *
 * GET /api/users/me/weekly-candid — return the user's most recent
 * candid + a `staleness` field so the dashboard widget can prompt
 * for a fresh one when the current candid is from a previous week.
 * It also reports `repCard` — whether the candid is live on client
 * email yet, and whether this viewer is the one testing it — so the
 * shell's prompt can tell the team the truth about where their photo
 * goes instead of implying it is already reaching clients.
 *
 * Storage: Vercel Blob at `agents/<userId>/<yyyy>/<mm>/candid-<uuid>...`.
 * Mirrors the claim/order upload helpers' `access: 'private' as
 * 'public'` cast — the same private-blob-store gap applies (URLs
 * are NOT publicly fetchable today; the public-store fix is owed
 * before email <img src> tags will render reliably for recipients).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { weekStartPacific } from '@/lib/orders/weekStart'
import { repCardEnabled, isRepCardTester } from '@/lib/email/repCardRollout'

export const dynamic = 'force-dynamic'

function safe(name: string): string {
  return name.replace(/[\\/\x00-\x1f]+/g, '_').replace(/\s+/g, '_').slice(0, 160) || 'candid.jpg'
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'invalid form' }, { status: 400 })
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }
  const buf = Buffer.from(await file.arrayBuffer())

  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `agents/${user.id}/${yyyy}/${mm}/candid-${randomUUID()}-${safe(file.name)}`
  const blob = await put(blobKey, buf, {
    access: 'private' as 'public',
    contentType: file.type || 'image/jpeg',
  })

  const weekStart = weekStartPacific(now)
  const row = await prisma.agentWeeklyCandid.create({
    data: {
      userId: user.id,
      fileUrl: blob.url,
      blobKey,
      mimeType: file.type || null,
      sizeBytes: buf.byteLength,
      weekStartDate: weekStart,
    },
  })

  return NextResponse.json(row, { status: 201 })
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const current = await prisma.agentWeeklyCandid.findFirst({
    where: { userId: user.id },
    orderBy: { capturedAt: 'desc' },
  })
  const thisWeekStart = weekStartPacific(new Date())
  const isThisWeek = current
    ? current.weekStartDate.getTime() === thisWeekStart.getTime()
    : false
  const ageDays = current
    ? Math.floor((Date.now() - current.capturedAt.getTime()) / 86_400_000)
    : null

  // Whose face ends up in front of a client: the sales roles plus the
  // admins who backstop them. A warehouse login gets no prompt.
  const onClientEmail = ['AGENT', 'ADMIN', 'MANAGER'].includes(user.role)

  return NextResponse.json({
    current,
    isThisWeek,
    ageDays,
    thisWeekStart: thisWeekStart.toISOString().slice(0, 10),
    repCard: {
      /** Live for everyone, or still dark while it is being tested. */
      enabled: await repCardEnabled(),
      /** This viewer is the one testing it — their own jobs carry it now. */
      viewerIsTester: isRepCardTester(session.user.email),
      /** Whether this viewer's photo can reach a client at all. */
      onClientEmail,
    },
  })
}
