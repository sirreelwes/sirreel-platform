import { NextResponse } from 'next/server'

const API_KEY = process.env.PLANYO_API_KEY || ''
const SITE_ID = process.env.PLANYO_SITE_ID || '36171'
const BASE = 'https://www.planyo.com/rest/'
export const dynamic = 'force-dynamic'

async function planyo(method: string, params: Record<string, string> = {}) {
  const url = new URL(BASE)
  url.searchParams.set('method', method)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('site_id', SITE_ID)
  url.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  return res.json()
}

// Map Planyo status codes to our status names
// Status 11 = confirmed/reserved, 4 = confirmed, 1 = new/pending, 2 = cancelled, etc.
function mapStatus(status: string): string {
  const s = parseInt(status)
  if (s === 11 || s === 4) return 'booked'
  if (s === 1) return 'inquiry'
  if (s === 8) return 'hold'
  return 'booked'
}

// Map Planyo resource names to our category keys
function mapCategory(resourceName: string): string {
  const n = resourceName.toLowerCase()
  if (n.includes('cube') || n.includes('5 ton')) return 'cube'
  if (n.includes('cargo') || n.includes('super cargo')) return 'cargo'
  if (n.includes('passenger') || n.includes('pass van')) return 'pass'
  if (n.includes('popvan') || n.includes('pop van')) return 'pop'
  if (n.includes('camera') || n.includes('cam')) return 'cam'
  if (n.includes('dlux') || n.includes('de luxe')) return 'dlux'
  if (n.includes('scout') || n.includes('vtr')) return 'scout'
  if (n.includes('studio')) return 'studio'
  if (n.includes('stakebed') || n.includes('stake')) return 'stakebed'
  return 'general'
}

const CAT_COLORS: Record<string, string> = {
  cube:     '#3b82f6',
  cargo:    '#8b5cf6',
  pass:     '#06b6d4',
  pop:      '#f59e0b',
  cam:      '#ec4899',
  dlux:     '#10b981',
  scout:    '#f97316',
  studio:   '#6366f1',
  stakebed: '#78716c',
  general:  '#9ca3af',
}

export async function GET() {
  try {
    if (!API_KEY) return NextResponse.json({ error: 'No Planyo API key' }, { status: 500 })

    const today = new Date()
    const from = new Date(today); from.setDate(from.getDate() - 14)
    const to = new Date(today); to.setDate(to.getDate() + 45)
    const fmt = (d: Date) => d.toISOString().slice(0, 10) + ' 00:00:00'

    const data = await planyo('list_reservations', {
      start_time: fmt(from),
      end_time: fmt(to),
      detail_level: '1',
      results_per_page: '500',
    })

    if (data.response_code !== 0) {
      return NextResponse.json({ error: data.response_message }, { status: 500 })
    }

    const reservations: any[] = data.data?.results || []

    // Group by cart_id (same job = same cart)
    const cartMap: Record<string, any[]> = {}
    for (const r of reservations) {
      const cartId = r.cart_id || r.reservation_id
      if (!cartMap[cartId]) cartMap[cartId] = []
      cartMap[cartId].push(r)
    }

    // Build jobs from cart groups
    const jobs = Object.entries(cartMap).map(([cartId, items]) => {
      const first = items[0]
      const clientName = `${first.first_name || ''} ${first.last_name || ''}`.trim()
      const status = mapStatus(first.status)

      // Each item in the cart = one vehicle reservation
      const jobItems = items.map(r => ({
        cat: mapCategory(r.name || ''),
        unit: r.unit_assignment || r.name || 'Unknown',
        resourceName: r.name || '',
        qty: parseInt(r.quantity) || 1,
        start: (r.start_time || '').slice(0, 10),
        end: (r.end_time || '').slice(0, 10),
        reservationId: r.reservation_id,
        adminNotes: r.admin_notes || '',
      }))

      const startDate = jobItems.reduce((min, i) => i.start < min ? i.start : min, jobItems[0].start)
      const endDate   = jobItems.reduce((max, i) => i.end   > max ? i.end   : max, jobItems[0].end)
      const cat = mapCategory(first.name || '')

      return {
        id: cartId,
        cartId,
        company: clientName,
        jobName: first.admin_notes?.split('\n')[0] || first.name || '',
        jobNum: `R${first.reservation_id}`,
        contact: clientName,
        agent: '',
        status,
        stage: status,
        startDate,
        endDate,
        color: CAT_COLORS[cat] || '#9ca3af',
        items: jobItems,
      }
    })

    // Also build asset-level view: unique units with their bookings
    const unitMap: Record<string, any[]> = {}
    for (const r of reservations) {
      const unitName = r.unit_assignment || r.name || 'Unknown'
      if (!unitMap[unitName]) unitMap[unitName] = []
      unitMap[unitName].push({
        reservationId: r.reservation_id,
        cartId: r.cart_id,
        clientName: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        resourceName: r.name || '',
        cat: mapCategory(r.name || ''),
        status: mapStatus(r.status),
        start: (r.start_time || '').slice(0, 10),
        end: (r.end_time || '').slice(0, 10),
        adminNotes: r.admin_notes || '',
        qty: parseInt(r.quantity) || 1,
      })
    }

    const units = Object.entries(unitMap)
      .map(([unitName, bookings]) => ({
        unitName,
        cat: bookings[0]?.cat || 'general',
        resourceName: bookings[0]?.resourceName || '',
        bookings: bookings.sort((a, b) => a.start.localeCompare(b.start)),
      }))
      .sort((a, b) => {
        // Sort by category then unit name
        const catOrder = ['cube', 'cargo', 'pass', 'pop', 'cam', 'dlux', 'scout', 'studio', 'stakebed', 'general']
        const ca = catOrder.indexOf(a.cat), cb = catOrder.indexOf(b.cat)
        if (ca !== cb) return ca - cb
        return a.unitName.localeCompare(b.unitName, undefined, { numeric: true })
      })

    jobs.sort((a, b) => a.startDate.localeCompare(b.startDate))

    return NextResponse.json({ ok: true, jobs, units, total: reservations.length })
  } catch (err: any) {
    console.error('[timeline]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
