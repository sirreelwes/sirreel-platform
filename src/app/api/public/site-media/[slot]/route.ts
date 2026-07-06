/**
 * GET /api/public/site-media/[slot] — PUBLIC proxy for the Home hero
 * media (poster image + optional loop video), stored in the PRIVATE
 * Vercel Blob store (a direct fetch of the raw blob URL 403s).
 *
 * Deliberately narrow — it resolves ONLY the two designated SiteSetting
 * hero fields and streams them; it can never serve an arbitrary blob:
 *
 *   slot=hero-image → SiteSetting.heroImageUrl
 *   slot=hero-video → SiteSetting.heroVideoUrl
 *
 * Unlike the private claims/COI proxy, this content is public and
 * cacheable — the hero is on the marketing site — so it streams inline
 * with a public max-age. Missing slot / unset field / unreachable blob
 * → 404 (the Home hero falls back to the dark hero on a 404).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { get as getBlob } from '@vercel/blob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slot: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { slot } = await params
  if (slot !== 'hero-image' && slot !== 'hero-video') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const settings = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { heroImageUrl: true, heroVideoUrl: true },
  })
  const fileUrl = slot === 'hero-image' ? settings?.heroImageUrl : settings?.heroVideoUrl
  if (!fileUrl) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let blob
  try {
    blob = await getBlob(fileUrl, { access: 'private' })
  } catch {
    return NextResponse.json({ error: 'blob unreachable' }, { status: 502 })
  }
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const contentType = blob.blob.contentType || 'application/octet-stream'
  return new Response(blob.stream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': 'inline',
      // Public marketing media — safe to cache at the edge. Short-ish so
      // an admin swap propagates within the hour without a redeploy.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
