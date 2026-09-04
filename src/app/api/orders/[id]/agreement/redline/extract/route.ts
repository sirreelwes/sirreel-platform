import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { extractRedline, type RedlineImage } from '@/lib/contracts/extractRedline'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/orders/[id]/agreement/redline/extract
 *
 * Reads a pasted redline (email text, a screenshot, or both) and returns the
 * amended clauses to review. Nothing is written — this only fills the form.
 * Saving is the separate POST to ../redline, which is where approval and the
 * link to the order's agreement happen.
 *
 * The order id is in the path for auth scope and so a future prompt can use
 * the job's own context; the extraction itself is order-independent.
 */

const ALLOWED_MEDIA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_IMAGES = 4
const MAX_IMAGE_BASE64 = 7_000_000 // ~5 MB of binary
const MAX_TEXT = 100_000

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as { text?: unknown; images?: unknown }
  const text = typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT) : ''

  const images: RedlineImage[] = []
  if (Array.isArray(body.images)) {
    for (const img of body.images.slice(0, MAX_IMAGES)) {
      const mediaType = String((img as any)?.media_type ?? '')
      const data = String((img as any)?.data ?? '')
      if (!ALLOWED_MEDIA.has(mediaType)) {
        return NextResponse.json(
          { error: `Unsupported image type "${mediaType}" — PNG, JPEG, GIF or WEBP.` },
          { status: 400 },
        )
      }
      if (!data || data.length > MAX_IMAGE_BASE64) {
        return NextResponse.json({ error: 'That image is too large — under 5 MB each.' }, { status: 400 })
      }
      images.push({ media_type: mediaType as RedlineImage['media_type'], data })
    }
  }

  const result = await extractRedline({ text, images })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({
    ok: true,
    amendments: result.amendments,
    unmatched: result.unmatched,
  })
}
