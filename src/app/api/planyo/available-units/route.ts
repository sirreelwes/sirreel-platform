import { NextRequest, NextResponse } from 'next/server'

const API_KEY = process.env.PLANYO_API_KEY || ''
const SITE_ID = process.env.PLANYO_SITE_ID || '36171'
const BASE = 'https://www.planyo.com/rest/'
export const dynamic = 'force-dynamic'

const RESOURCE_IDS: Record<string, string> = {
  cube: '116560', cargo: '117102', cargoNoLG: '117105',
  pass: '117158', pop: '117155', cam: '117156',
  dlux: '117161', scout: '117159', stakebed: '117160', studio: '128064',
}

async function planyoFetch(params: Record<string,string>) {
  const url = new URL(BASE)
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('site_id', SITE_ID)
  url.searchParams.set('format', 'json')
  const res = await fetch(url.toString())
  return res.json()
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const cat = url.searchParams.get('cat') || ''
  const startDate = url.searchParams.get('start') || ''
  const endDate = url.searchParams.get('end') || ''

  const resourceId = RESOURCE_IDS[cat]
  if (!resourceId) return NextResponse.json({ error: 'Unknown category' }, { status: 400 })

  // Fetch ALL known units for this resource (last 6 months to capture all unit names)
  const historyFrom = new Date(); historyFrom.setMonth(historyFrom.getMonth() - 6)
  const historyTo = new Date(); historyTo.setMonth(historyTo.getMonth() + 3)
  const fmt = (d: Date) => d.toISOString().slice(0, 10) + ' 00:00:00'

  // Fetch all historical reservations to discover unit names
  const [historyData, requestedData] = await Promise.all([
    planyoFetch({
      method: 'list_reservations',
      resource_id: resourceId,
      start_time: fmt(historyFrom),
      end_time: fmt(historyTo),
      results_per_page: '500',
      detail_level: '1',
    }),
    // Fetch reservations that overlap the requested date range
    planyoFetch({
      method: 'list_reservations',
      resource_id: resourceId,
      start_time: startDate + ' 00:00:00',
      end_time: endDate + ' 23:59:00',
      results_per_page: '500',
      detail_level: '1',
    }),
  ])

  const allHistorical: any[] = historyData.data?.results || []
  const inRange: any[] = requestedData.data?.results || []

  // Build complete unit list from historical data
  const allUnitNames = new Set<string>()
  for (const r of allHistorical) {
    if (r.unit_assignment) allUnitNames.add(r.unit_assignment)
  }

  // Find which units are booked in the requested date range
  const bookedInRange = new Set<string>()
  for (const r of inRange) {
    if (r.unit_assignment) {
      // Check actual date overlap
      const rStart = (r.start_time || '').slice(0, 10)
      const rEnd = (r.end_time || '').slice(0, 10)
      if (rStart <= endDate && rEnd >= startDate) {
        bookedInRange.add(r.unit_assignment)
      }
    }
  }

  // Build unit list sorted naturally
  const units = [...allUnitNames]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(name => ({
      name,
      available: !bookedInRange.has(name),
      bookedBy: bookedInRange.has(name)
        ? (() => {
            const booking = inRange.find(r => r.unit_assignment === name)
            return booking ? (booking.properties?.Company_Name || (booking.first_name + ' ' + booking.last_name).trim()) : 'Booked'
          })()
        : null,
    }))

  return NextResponse.json({
    ok: true,
    units,
    availableCount: units.filter(u => u.available).length,
    totalCount: units.length,
  })
}
