import { NextRequest, NextResponse } from 'next/server'

const API_KEY = process.env.PLANYO_API_KEY || ''
const SITE_ID = process.env.PLANYO_SITE_ID || '36171'
const BASE = 'https://www.planyo.com/rest/'
export const dynamic = 'force-dynamic'

function mapStatus(status: string): string {
  const s = parseInt(status)
  if (s === 11 || s === 4 || s === 3) return 'confirmed'
  if (s === 8) return 'hold'
  if (s === 1) return 'inquiry'
  return 'booked'
}

export async function GET(req: NextRequest) {
  const rwOrder = new URL(req.url).searchParams.get('rwOrder')
  if (!rwOrder) return NextResponse.json({ error: 'rwOrder required' }, { status: 400 })

  const from = new Date(); from.setFullYear(from.getFullYear() - 1)
  const to = new Date(); to.setFullYear(to.getFullYear() + 1)
  const fmt = (d: Date) => d.toISOString().slice(0, 10) + ' 00:00:00'

  const url = new URL(BASE)
  url.searchParams.set('method', 'list_reservations')
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('site_id', SITE_ID)
  url.searchParams.set('format', 'json')
  url.searchParams.set('start_time', fmt(from))
  url.searchParams.set('end_time', fmt(to))
  url.searchParams.set('results_per_page', '500')
  url.searchParams.set('detail_level', '3')

  const data = await fetch(url.toString()).then(r => r.json())
  const all: any[] = data.data?.results || []

  const matched = all.filter((r: any) => {
    const notes = r.user_notes || ''
    return notes.includes('#' + rwOrder) || notes.trim().startsWith(rwOrder)
  })

  const vehicles = matched.map((r: any) => ({
    reservationId: r.reservation_id,
    unit: r.unit_assignment || r.name || 'Unknown',
    resourceName: r.name || '',
    status: mapStatus(r.status),
    start: (r.start_time || '').slice(0, 10),
    end: (r.end_time || '').slice(0, 10),
    clientName: (r.properties && r.properties.Company_Name) || (r.first_name + ' ' + r.last_name).trim(),
    jobName: (r.properties && r.properties.Job_Name) || '',
    agent: (r.properties && r.properties.SirReel_Agent) || '',
    adminNotes: r.admin_notes || '',
  }))

  return NextResponse.json({ ok: true, vehicles, total: matched.length })
}
