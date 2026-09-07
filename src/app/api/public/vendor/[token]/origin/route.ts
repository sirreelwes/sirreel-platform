/**
 * POST /api/public/vendor/[token]/origin — REFUSED since 2026-09-07.
 *
 * Wes: "we cannot give them an option to change start location. That is
 * our choice — it should just say that we expect start location to be
 * here." The partner page now STATES the start location (Vendor.lotAddress,
 * or a per-booking SubRental.originAddress) and offers no control; HQ sets
 * both on the vendor record / the sub-rental. Kept as a route so a stale
 * page gets a clear answer instead of a 404.
 *
 * Until 2026-09-07 this wrote Vendor.lotAddress and SubRental.originAddress
 * from the partner page (audit actions vendor.lot_address_updated /
 * sub_rental.origin_updated).
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    { ok: false, error: 'The start location is set by SirReel. If it looks wrong, reply to your booking email.' },
    { status: 403 },
  )
}
