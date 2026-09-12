/**
 * GET /api/public/partner-logo/[id] — a partner's own wordmark, for the
 * co-branded masthead on partner email.
 *
 * Unauthenticated on purpose: an inbox has no session and no token, and
 * Gmail fetches the image through its own proxy. What it exposes is the
 * partner's public brand mark, to the partner, keyed by an opaque id — and
 * nothing else about the vendor. Rates, bookings and contacts stay behind
 * the account token.
 *
 * Raster only, matching `partnerLogoEmailUrl()`: mail clients do not render
 * SVG, so a vector-only mark is a 404 here and the mail falls back to the
 * partner's name in type rather than a broken image.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const v = await prisma.vendor.findUnique({
    where: { id: params.id },
    select: { name: true, logoUrl: true, logoSvg: true, isActive: true },
  })
  if (!v || !v.isActive || v.logoSvg || !v.logoUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (/\.svgz?(\?|#|$)/i.test(v.logoUrl)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const res = await streamPrivateBlobAsResponse({
    fileUrl: v.logoUrl,
    filename: `${v.name.replace(/[^A-Za-z0-9._-]+/g, '-')}-logo`,
  })
  // Public so Gmail's image proxy will cache it rather than re-fetching on
  // every open; a logo is not private data.
  res.headers.set('Cache-Control', 'public, max-age=86400')
  return res
}
