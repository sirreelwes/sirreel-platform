import { NextRequest, NextResponse } from 'next/server'

const API_KEY = process.env.PLANYO_API_KEY || ''
const SITE_ID = process.env.PLANYO_SITE_ID || '36171'
const BASE = 'https://www.planyo.com/rest/'
export const dynamic = 'force-dynamic'

// Planyo resource IDs
const RESOURCE_IDS: Record<string, string> = {
  cube:     '116560',
  cargo:    '117102',
  cargoNoLG:'117105',
  pass:     '117158',
  pop:      '117155',
  cam:      '117156',
  dlux:     '117161',
  scout:    '117159',
  stakebed: '117160',
  studio:   '128064',
}

// All known units per category (from DB seed)
const UNITS_BY_CAT: Record<string, string[]> = {
  cube:     Array.from({length:41}, (_,i) => `Cube #${i+1}`),
  cargo:    ['Super Cargo #1 (A)','Super Cargo #2 (A)','Super Cargo #3 (A)','Super Cargo #4 (A)','Super Cargo #5 (A)',
             'Super Cargo #6 (A)','Super Cargo #7 (A)','Super Cargo #8 (A)','Super Cargo #9 (A)','Super Cargo #10 (A)',
             'Super Cargo #11 (A)','Super Cargo #12 (A)','Super Cargo #13 (A)','Super Cargo #14 (A)','Super Cargo #15 (A)',
             'Super Cargo #16 (A)','Super Cargo #17 (A)','Super Cargo #18 (A)','Super Cargo #19 (A)','Super Cargo #20 (A)',
             'Super Cargo #21 (A)','Super Cargo #22 (A)','Super Cargo #23 (A)','Super Cargo #24 (A)','Super Cargo #25 (A)',
             'Super Cargo #26 (A)','Super Cargo #27 (A)','Super Cargo #28 (A)','Super Cargo #29 (A)','Super Cargo #30 (A)'],
  pass:     Array.from({length:10}, (_,i) => `Passenger Van #${i+1}`),
  pop:      Array.from({length:9},  (_,i) => `PopVan #${i+1}`),
  cam:      Array.from({length:7},  (_,i) => `Camera Cube #${i+1}`),
  dlux:     Array.from({length:8},  (_,i) => `DLUX #${i+1}`),
  scout:    Array.from({length:3},  (_,i) => `ProScout #${i+1}`),
  stakebed: Array.from({length:3},  (_,i) => `Stakebed #${i+1}`),
  studio:   ['Lankershim Studio','A - Standing Sets','B - Standing Sets','LED Volume Stage'],
}

async function planyo(method: string, params: Record<string,string>) {
  const url = new URL(BASE)
  url.searchParams.set('method', method)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('site_id', SITE_ID)
  url.searchParams.set('format', 'json')
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  return res.json()
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const cat      = url.searchParams.get('cat') || ''
  const startDate = url.searchParams.get('start') || ''
  const endDate   = url.searchParams.get('end') || ''

  const resourceId = RESOURCE_IDS[cat]
  if (!resourceId) return NextResponse.json({ error: 'Unknown category' }, { status: 400 })

  // Get all reservations for this resource in this date range
  const data = await planyo('list_reservations', {
    resource_id: resourceId,
    start_time: startDate + ' 00:00:00',
    end_time: endDate + ' 23:59:00',
    results_per_page: '500',
    detail_level: '1',
  })

  const reservations: any[] = data.data?.results || []
  const bookedUnits = new Set(reservations.map((r: any) => r.unit_assignment).filter(Boolean))

  const allUnits = UNITS_BY_CAT[cat] || []

  // Get real unit names from Planyo if we have bookings
  // Use booked units to infer available ones
  const units = allUnits.map(name => ({
    name,
    available: !bookedUnits.has(name),
    bookedBy: reservations.find((r: any) => r.unit_assignment === name)
      ? `${reservations.find((r: any) => r.unit_assignment === name).first_name} ${reservations.find((r: any) => r.unit_assignment === name).last_name}`.trim()
      : null,
  }))

  // Also include any booked units not in our list (Planyo has the real names)
  for (const r of reservations) {
    const name = r.unit_assignment
    if (name && !allUnits.includes(name)) {
      units.push({ name, available: false, bookedBy: `${r.first_name} ${r.last_name}`.trim() })
    }
  }

  return NextResponse.json({ ok: true, units, resourceId })
}
