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

function normalize(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export async function GET(req: NextRequest) {
  const url2 = new URL(req.url)
  const rwOrder   = url2.searchParams.get('rwOrder') || ''
  const company   = url2.searchParams.get('company') || ''
  const startDate = url2.searchParams.get('start') || ''
  const endDate   = url2.searchParams.get('end') || ''

  const from = new Date(startDate || Date.now())
  from.setDate(from.getDate() - 14)
  const to = new Date(endDate || Date.now())
  to.setDate(to.getDate() + 14)
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

  // Match by RW order number in user_notes
  let matched = rwOrder ? all.filter((r: any) => {
    const notes = r.user_notes || ''
    return notes.includes('#' + rwOrder) || notes.trim().startsWith(rwOrder)
  }) : []

  // Fallback: match by company name + date overlap
  if (matched.length === 0 && company) {
    const normCompany = normalize(company)
    matched = all.filter((r: any) => {
      const planyoCompany = normalize(r.properties?.Company_Name || r.first_name + r.last_name)
      return planyoCompany && normCompany && (
        planyoCompany.includes(normCompany.slice(0, 8)) ||
        normCompany.includes(planyoCompany.slice(0, 8))
      )
    })
  }

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
    matchedBy: matched === all.filter((x: any) => (x.user_notes || '').includes('#' + rwOrder)) ? 'orderNumber' : 'company',
  }))

  return NextResponse.json({ ok: true, vehicles, total: matched.length })
}
