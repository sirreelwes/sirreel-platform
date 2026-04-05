import { NextResponse } from 'next/server'

const API_KEY = process.env.PLANYO_API_KEY || ''
const SITE_ID = process.env.PLANYO_SITE_ID || '36171'
const BASE = 'https://www.planyo.com/rest/'
export const dynamic = 'force-dynamic'

function mapStatus(status: string): string {
  const s = parseInt(status)
  if (s === 11 || s === 4 || s === 3) return 'confirmed'
  if (s === 8) return 'hold'
  if (s === 1) return 'inquiry'
  if (s === 2) return 'cancelled'
  return 'booked'
}

export async function GET() {
  const from = new Date(); from.setDate(from.getDate() - 30)
  const to = new Date(); to.setDate(to.getDate() + 60)
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

  const unlinked = all
    .filter((r: any) => {
      const notes = (r.user_notes || '').trim()
      const hasOrderNum = /^#\d+|\n#\d+/.test(notes) || /#\d{5,}/.test(notes)
      const status = parseInt(r.status)
      const isCancelled = status === 2
      return !hasOrderNum && !isCancelled
    })
    .map((r: any) => ({
      reservationId: r.reservation_id,
      cartId: r.cart_id,
      unit: r.unit_assignment || r.name || 'Unknown',
      resourceName: r.name || '',
      status: mapStatus(r.status),
      start: (r.start_time || '').slice(0, 10),
      end: (r.end_time || '').slice(0, 10),
      company: (r.properties && r.properties.Company_Name) || '',
      jobName: (r.properties && r.properties.Job_Name) || '',
      agent: (r.properties && r.properties.SirReel_Agent) || '',
      clientName: (r.first_name + ' ' + r.last_name).trim(),
      userNotes: r.user_notes || '',
    }))
    .sort((a: any, b: any) => a.start.localeCompare(b.start))

  return NextResponse.json({ ok: true, unlinked, total: unlinked.length })
}
