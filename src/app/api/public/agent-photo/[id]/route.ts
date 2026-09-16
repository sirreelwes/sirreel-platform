/**
 * GET /api/public/agent-photo/[id]?v=<photoId> — a SirReel rep's photo, for
 * the rep card on client email.
 *
 * Unauthenticated on purpose, and for the same reason as
 * /api/public/partner-logo/[id]: an inbox has no session and no token, and
 * Gmail fetches the image through its own proxy, so a session-gated or
 * token-gated URL silently 403s and the picture never arrives. This route
 * exists because the weekly-candid blobs are written `access: 'private'` —
 * the gap that route's own header calls out ("the public-store fix is owed
 * before email <img src> tags will render reliably for recipients").
 *
 * What it exposes is one active staff member's photo, keyed by an opaque
 * uuid, and nothing else — no name, no number, no jobs.
 *
 * TWO stores reach this route, because two emails use it: the welcome's rep
 * card carries a published "Who we are" headshot, and the thank-you carries
 * the rep's weekly candid.
 *
 * `?v=` pins WHICH photo, so a mail sent in September still shows the picture
 * it was sent with when the thread is reopened in November. Every send builds
 * one, so the no-`v` path below is only a safety net — it prefers the roster
 * headshot (what the card would have used) and falls back to the newest
 * candid, so a stray link resolves to a face rather than a broken image.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

function notFound() {
  return NextResponse.json({ error: 'not found' }, { status: 404 })
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = params.id
  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true },
    select: { id: true },
  })
  if (!user) return notFound()

  const wanted = req.nextUrl.searchParams.get('v')
  let fileUrl: string | null = null

  if (wanted) {
    // Both stores are checked BY ID AND BY USER, so a `v` from one rep can
    // never pull another rep's photo through this path.
    const candid = await prisma.agentWeeklyCandid
      .findFirst({ where: { id: wanted, userId }, select: { fileUrl: true } })
      .catch(() => null)
    fileUrl = candid?.fileUrl ?? null
    if (!fileUrl) {
      const member = await prisma.teamMember
        .findFirst({ where: { id: wanted, userId, published: true }, select: { photoUrl: true } })
        .catch(() => null)
      fileUrl = member?.photoUrl ?? null
    }
  }

  if (!fileUrl) {
    const member = await prisma.teamMember
      .findFirst({
        where: { userId, published: true, photoUrl: { not: null } },
        select: { photoUrl: true },
      })
      .catch(() => null)
    fileUrl = member?.photoUrl ?? null
  }
  if (!fileUrl) {
    const candid = await prisma.agentWeeklyCandid
      .findFirst({
        where: { userId },
        orderBy: { capturedAt: 'desc' },
        select: { fileUrl: true },
      })
      .catch(() => null)
    fileUrl = candid?.fileUrl ?? null
  }

  if (!fileUrl) return notFound()

  const res = await streamPrivateBlobAsResponse({ fileUrl, filename: `${userId}.jpg` })
  // Public so Gmail's proxy caches it instead of re-fetching on every open.
  // An hour rather than a day: a candid is meant to change weekly and a
  // roster photo can be replaced at any time, while a pinned `?v=` is what
  // keeps an already-sent mail stable.
  res.headers.set('Cache-Control', 'public, max-age=3600')
  return res
}
