import { NextRequest, NextResponse } from 'next/server'

const API_KEY = process.env.PLANYO_API_KEY || ''
const SITE_ID = process.env.PLANYO_SITE_ID || '36171'
const BASE = 'https://www.planyo.com/rest/'

export async function POST(req: NextRequest) {
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
