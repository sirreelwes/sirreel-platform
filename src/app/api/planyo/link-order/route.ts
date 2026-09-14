import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  planyoMirrorEnabled,
  PLANYO_MIRROR_RETIRED_ON,
} from '@/lib/sync/planyo/mirrorSwitch'

const API_KEY = process.env.PLANYO_API_KEY || ''
const SITE_ID = process.env.PLANYO_SITE_ID || '36171'
const BASE = 'https://www.planyo.com/rest/'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // Retired with the mirror (2026-09-14). This is the one route in the
  // system that WRITES BACK to Planyo — it stamps an RW order number into
  // a reservation's user_notes via modify_reservation. Past the cutover
  // that is an edit to a book nobody reads, made against reservations HQ
  // no longer tracks, so it is refused rather than left to write into the
  // dark. 410 Gone, not 404: the route existed and was deliberately ended.
  if (!planyoMirrorEnabled()) {
    return NextResponse.json(
      {
        error: 'Planyo linking was retired on ' + PLANYO_MIRROR_RETIRED_ON +
          ' — reservations are made in HQ only. Link the RentalWorks order from the job page instead.',
        retired: true,
      },
      { status: 410 },
    )
  }

  try {
    const { reservationId, rwOrderNumber, existingNotes } = await req.json()
    if (!reservationId || !rwOrderNumber) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const newNotes = ('#' + rwOrderNumber + (existingNotes ? '\n' + existingNotes : '')).trim()

    const url = new URL(BASE)
    url.searchParams.set('method', 'modify_reservation')
    url.searchParams.set('api_key', API_KEY)
    url.searchParams.set('site_id', SITE_ID)
    url.searchParams.set('format', 'json')
    url.searchParams.set('reservation_id', reservationId)
    url.searchParams.set('user_notes', newNotes)
    url.searchParams.set('admin_mode', 'true')

    const data = await fetch(url.toString()).then(r => r.json())

    if (data.response_code !== 0) {
      return NextResponse.json({ error: data.response_message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
