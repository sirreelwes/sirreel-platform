/**
 * GET /api/public/search?q=&limit= — site-wide public typeahead.
 *
 * Unauthenticated. One ranked list across supplies/equipment, vehicles,
 * stages, standing sets and the static public pages. Every row is
 * public-safe: name, category, destination, image-proxy path. NO rates —
 * pricing stays on the pages that frame it.
 *
 * Matching + visibility live in src/lib/site/publicSearch.ts (in-process
 * index, 60s TTL) so this route stays a thin, cacheable edge over it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { searchPublicSite } from '@/lib/site/publicSearch'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') || '8', 10)))
  if (!q) return NextResponse.json({ results: [] })
  try {
    const results = await searchPublicSite(q, limit)
    return NextResponse.json({ results })
  } catch (err) {
    // A search box must never take the homepage down — degrade to "no
    // hits" and let the Enter-key fallback carry the user to the form.
    console.error('[public-search] failed:', err)
    return NextResponse.json({ results: [] })
  }
}
