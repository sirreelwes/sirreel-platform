import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { get } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { generateQuotePdf, ensureFreshQuotePdf } from '@/lib/orders/generateQuotePdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

// Generate the client-facing Quote PDF for an Order and persist its blob
// key/url on the Order. Mirrors the contract counter-PDF pattern:
// replace-on-regenerate (delete the previous blob), private bucket
// access, idempotent.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const res = await generateQuotePdf(params.id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })

  return NextResponse.json({
    ok: true,
    url: res.url,
    key: res.key,
    generatedAt: res.generatedAt.toISOString(),
  })
}

// Streams the Quote PDF bytes for an Order through this auth-gated
// route. Private Vercel Blob URLs aren't directly fetchable from the
// browser — we always proxy through server-side auth via @vercel/blob's
// `get()`. Mirrors the contract counter-PDF route.
//
// Modes:
//   default          → Content-Disposition: inline   (renders in browser tab)
//   ?download=1      → Content-Disposition: attachment (triggers file download)
//   ?meta=1          → JSON metadata only (no proxy), for status-style polls
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Serving the PDF is one of the two moments staleness actually bites, so
  // re-cut first when the order has moved since the last render. No-ops when
  // the PDF is current or absent, and never throws — a failed refresh serves
  // the prior document rather than a 500.
  await ensureFreshQuotePdf(params.id)

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      orderNumber: true,
      quotePdfKey: true,
      quotePdfUrl: true,
      quotePdfGeneratedAt: true,
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const wantMeta = req.nextUrl.searchParams.get('meta') === '1'
  if (wantMeta) {
    return NextResponse.json({
      url: order.quotePdfUrl,
      key: order.quotePdfKey,
      generatedAt: order.quotePdfGeneratedAt,
    })
  }

  if (!order.quotePdfKey) {
    return NextResponse.json({ error: 'No quote PDF for this order' }, { status: 404 })
  }

  const wantDownload = req.nextUrl.searchParams.get('download') === '1'
  const disposition = wantDownload
    ? `attachment; filename="Quote-${order.orderNumber}.pdf"`
    : `inline; filename="Quote-${order.orderNumber}.pdf"`

  try {
    const blob = await get(order.quotePdfKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'File not available' }, { status: 502 })
    }
    const headers = new Headers()
    headers.set('Content-Type', blob.blob.contentType || 'application/pdf')
    headers.set('Content-Disposition', disposition)
    if (blob.blob.size != null) headers.set('Content-Length', String(blob.blob.size))
    headers.set('Cache-Control', 'private, no-store')
    return new NextResponse(blob.stream, { status: 200, headers })
  } catch (err) {
    console.error('[quote-pdf] proxy error:', err)
    return NextResponse.json({ error: 'Failed to fetch quote PDF' }, { status: 500 })
  }
}
