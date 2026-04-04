import { NextResponse } from 'next/server'

const API_KEY = process.env.PLANYO_API_KEY || ''
const SITE_ID = process.env.PLANYO_SITE_ID || '36171'
const BASE = 'https://www.planyo.com/rest/'

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

export const dynamic = 'force-dynamic'

export async function GET() {
  const today = new Date()
  const from = new Date(today); from.setDate(from.getDate() - 7)
  const to = new Date(today); to.setDate(to.getDate() + 30)

  const fmt = (d: Date) => d.toISOString().slice(0, 10) + ' 00:00:00'

  const [reservations, resources] = await Promise.all([
    planyo('list_reservations', {
      start_time: fmt(from),
      end_time: fmt(to),
      detail_level: '1',
      results_per_page: '100',
    }),
    planyo('list_resources', {
      results_per_page: '200',
    }),
  ])

  return NextResponse.json({ reservations, resources })
}
