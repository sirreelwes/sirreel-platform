import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { extractRedline, type RedlineImage } from '@/lib/contracts/extractRedline'

export const dynamic = 'force-dynamic'
// A dropped PDF is rasterized page-by-page before the model sees it, so this
// runs longer than a pasted email does.
export const maxDuration = 300

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
const MAX_PDF_BASE64 = 20_000_000 // ~15 MB of binary

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

  const body = (await req.json().catch(() => ({}))) as {
    text?: unknown
    images?: unknown
    pdf?: unknown
  }
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

  let pdf: Buffer | undefined
  if (typeof body.pdf === 'string' && body.pdf.length > 0) {
    if (body.pdf.length > MAX_PDF_BASE64) {
      return NextResponse.json({ error: 'That PDF is too large — under 15 MB.' }, { status: 400 })
    }
    pdf = Buffer.from(body.pdf, 'base64')
  }

  const result = await extractRedline({ text, images, pdf })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({
    ok: true,
    amendments: result.amendments,
    unmatched: result.unmatched,
  })
}
