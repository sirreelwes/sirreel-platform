/**
 * GET /api/public/site-media/[slot] — PUBLIC proxy for the Home hero
 * media (poster image + optional loop video), stored in the PRIVATE
 * Vercel Blob store (a direct fetch of the raw blob URL 403s).
 *
 * Deliberately narrow — it resolves ONLY the designated SiteSetting hero
 * fields and streams them; it can never serve an arbitrary blob:
 *
 *   slot=hero-poster       → SiteSetting.heroPosterUrl
 *   slot=hero-video        → SiteSetting.heroVideoUrl
 *   slot=hero-video-mobile → SiteSetting.heroVideoMobileUrl
 *   slot=tile-trucking      → SiteSetting.tileTruckingUrl
 *   slot=tile-stages        → SiteSetting.tileStagesUrl
 *   slot=tile-standing-sets → SiteSetting.tileStandingSetsUrl
 *   slot=tile-led-wall      → SiteSetting.tileLedWallUrl
 *   slot=tile-supplies      → SiteSetting.tileSuppliesUrl
 *   slot=tile-radios-wifi   → SiteSetting.tileRadiosWifiUrl
 *   slot=tile-grip-electric → SiteSetting.tileGripElectricUrl
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

const SLOT_FIELD = {
  'hero-poster': 'heroPosterUrl',
  'hero-video': 'heroVideoUrl',
  'hero-video-mobile': 'heroVideoMobileUrl',
  'tile-trucking': 'tileTruckingUrl',
  'tile-stages': 'tileStagesUrl',
  'tile-standing-sets': 'tileStandingSetsUrl',
  'tile-led-wall': 'tileLedWallUrl',
  'tile-supplies': 'tileSuppliesUrl',
  'tile-radios-wifi': 'tileRadiosWifiUrl',
  'tile-grip-electric': 'tileGripElectricUrl',
} as const

export async function GET(_req: NextRequest, { params }: Params) {
  const { slot } = await params
  const field = SLOT_FIELD[slot as keyof typeof SLOT_FIELD]
  if (!field) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const settings = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: {
      heroPosterUrl: true, heroVideoUrl: true, heroVideoMobileUrl: true,
      tileTruckingUrl: true, tileStagesUrl: true, tileStandingSetsUrl: true,
      tileLedWallUrl: true, tileSuppliesUrl: true,
      tileRadiosWifiUrl: true, tileGripElectricUrl: true,
    },
  })
  const fileUrl = settings?.[field]
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
