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
 * `?v=` pins WHICH photo, so a mail sent in September still shows September's
 * candid when the thread is reopened in November. An absent or unrecognised
 * `v` falls back to the same ladder the composer used (`pickRepPhoto`), so
 * the two cannot disagree and leave a broken image in an inbox.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { pickRepPhoto } from '@/lib/email/repCard'
import { loadRepPhotoSources } from '@/lib/email/resolveRepCard'

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
    const pick = pickRepPhoto(await loadRepPhotoSources(userId), new Date())
    if (!pick) return notFound()
    if (pick.source === 'candid') {
      const row = await prisma.agentWeeklyCandid
        .findUnique({ where: { id: pick.id }, select: { fileUrl: true } })
        .catch(() => null)
      fileUrl = row?.fileUrl ?? null
    } else {
      const row = await prisma.teamMember
        .findUnique({ where: { id: pick.id }, select: { photoUrl: true } })
        .catch(() => null)
      fileUrl = row?.photoUrl ?? null
    }
  }

  if (!fileUrl) return notFound()

  const res = await streamPrivateBlobAsResponse({ fileUrl, filename: `${userId}.jpg` })
  // Public so Gmail's proxy caches it instead of re-fetching on every open.
  // An hour rather than a day: the candid is meant to change weekly, and a
  // pinned `?v=` is what keeps an already-sent mail stable.
  res.headers.set('Cache-Control', 'public, max-age=3600')
  return res
}
