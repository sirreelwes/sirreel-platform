import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/geo/address-search?q=…  → address suggestions for the
 * delivery/pickup site field.
 *
 * Backed by OpenStreetMap Nominatim rather than Google Places: there is
 * no Google Maps/Places key in this project (only OAuth client creds),
 * and adding a billed key + client-side key exposure for one typeahead
 * is not worth it. Nominatim is free and adequate for "type a street,
 * pick the real address".
 *
 * Proxied SERVER-side deliberately:
 *   · Nominatim's usage policy requires an identifying User-Agent /
 *     Referer — a browser fetch cannot set User-Agent.
 *   · Keeps staff site addresses (client shoot locations) out of a
 *     third-party request made from the client's browser.
 *   · Lets us cache and rate-limit in one place.
 *
 * Results are biased to the US and capped at 6. Free-text entry still
 * works everywhere this is used — the picker is an assist, never a
 * gate, since film sets are routinely at unaddressed locations
 * ("Ranch gate 3, dirt road past the cattle guard").
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const CONTACT = 'SirReel HQ (hq.sirreel.com; ops@sirreel.com)'

interface NominatimHit {
  display_name?: string
  lat?: string
  lon?: string
  address?: Record<string, string>
}

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  // Two chars is noise; Nominatim asks callers not to fire on every
  // keystroke of a short string.
  if (q.length < 4) return NextResponse.json({ results: [] })

  const url = new URL(ENDPOINT)
  url.searchParams.set('q', q)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', '6')
  url.searchParams.set('countrycodes', 'us')

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': CONTACT, Accept: 'application/json' },
      // Same address typed twice in a session shouldn't re-hit them.
      next: { revalidate: 3600 },
    })
    if (!res.ok) return NextResponse.json({ results: [], error: `geocoder ${res.status}` })
    const hits = (await res.json()) as NominatimHit[]
    return NextResponse.json({
      results: hits.map((h) => {
        const a = h.address ?? {}
        const line1 = [a.house_number, a.road].filter(Boolean).join(' ')
        const city = a.city || a.town || a.village || a.hamlet || a.suburb || ''
        return {
          label: h.display_name ?? '',
          // What we actually drop into the field — a mailing-style line,
          // not Nominatim's comma-heavy display_name.
          value: [line1 || a.road || '', city, a.state, a.postcode].filter(Boolean).join(', '),
          lat: h.lat ?? null,
          lon: h.lon ?? null,
        }
      }).filter((r) => r.value),
    })
  } catch (err) {
    // Never fail the form because the geocoder is down — the field is
    // free-text underneath.
    console.error('[geo/address-search]', err)
    return NextResponse.json({ results: [] })
  }
}
