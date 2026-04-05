import { NextRequest, NextResponse } from 'next/server'

const API_KEY = process.env.PLANYO_API_KEY || ''
const SITE_ID = process.env.PLANYO_SITE_ID || '36171'
const BASE = 'https://www.planyo.com/rest/'
export const dynamic = 'force-dynamic'

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

export async function POST(req: NextRequest) {
  try {
    const {
      cat, unit, startDate, endDate, status,
      rwOrderNumber, companyName, jobName, agentName,
      clientFirstName, clientLastName, clientEmail,
    } = await req.json()

    const resourceId = RESOURCE_IDS[cat]
    if (!resourceId) return NextResponse.json({ error: 'Unknown category' }, { status: 400 })

    // Planyo status: 8=hold, 11=confirmed
    const planyoStatus = status === 'confirmed' ? '11' : '8'

    const url = new URL(BASE)
    const params: Record<string,string> = {
      method: 'make_reservation',
      api_key: API_KEY,
      site_id: SITE_ID,
      format: 'json',
      resource_id: resourceId,
      start_time: startDate + ' 00:00:00',
      end_time: endDate + ' 23:59:00',
      first_name: clientFirstName || companyName || 'SirReel',
      last_name: clientLastName || 'Admin',
      email: clientEmail || 'wes@sirreel.com',
      assignment1: unit,
      quantity: '1',
      status: planyoStatus,
      admin_mode: 'true',
      user_notes: rwOrderNumber ? `#${rwOrderNumber}` : '',
      rental_prop_Company_Name: companyName || '',
      rental_prop_Job_Name: jobName || '',
      rental_prop_SirReel_Agent: agentName || '',
    }

    for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url.toString())
    const data = await res.json()

    if (data.response_code !== 0) {
      return NextResponse.json({ error: data.response_message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, reservationId: data.reservation_id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
