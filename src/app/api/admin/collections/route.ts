import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function sumPeriod(rows: any[], from: string, to: string) {
  const filtered = rows.filter(r => {
    const d = r.date.toISOString().slice(0, 10)
    return d >= from && d <= to
  })
  return {
    cardpointe:    filtered.reduce((s, r) => s + Number(r.cardpointe), 0),
    rentalworks:   filtered.reduce((s, r) => s + Number(r.rentalworks), 0),
    ordersCreated: filtered.reduce((s, r) => s + Number(r.orders_created), 0),
    quotesCreated: filtered.reduce((s, r) => s + Number(r.quotes_created), 0),
    days: filtered.length,
  }
}

function pct(curr: number, prev: number) {
  if (prev === 0) return curr > 0 ? 100 : 0
  return Math.round(((curr - prev) / prev) * 100)
}

function compare(curr: any, prev: any) {
  const total = (p: any) => p.rentalworks // RW is the total; CP is a subset (CC portion only)
  return {
    curr, prev,
    pctCardpointe:  pct(curr.cardpointe, prev.cardpointe),
    pctRentalworks: pct(curr.rentalworks, prev.rentalworks),
    pctTotal:       pct(total(curr), total(prev)),
    pctOrders:      pct(curr.ordersCreated, prev.ordersCreated),
  }
}

function startOfWeek(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // One-time fix for Mar 12 data entry typo ($20,1319.90 should be $20,319.90)
    await prisma.$executeRaw`UPDATE daily_collections SET rentalworks = 20319.90 WHERE rentalworks > 50000`

    const rows = await prisma.$queryRaw<any[]>`
      SELECT date, cardpointe, rentalworks, orders_created, quotes_created
      FROM daily_collections
      ORDER BY date DESC
      LIMIT 400
    `

    if (!rows.length) {
      return NextResponse.json({ ok: true, day: null, week: null, month: null, year: null, recent: [] })
    }

    const now = new Date()
    const today     = now.toISOString().slice(0, 10)
    const yesterday = addDays(today, -1)

    const thisWeekStart = startOfWeek(today)
    const lastWeekStart = addDays(thisWeekStart, -7)
    const lastWeekEnd   = addDays(thisWeekStart, -1)

    const thisMonthStart = today.slice(0, 7) + '-01'
    const lastMonthDate  = new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
    const lastMonthStart = lastMonthDate.toISOString().slice(0, 10)
    const lastMonthEnd   = addDays(thisMonthStart, -1)

    const thisYearStart = today.slice(0, 4) + '-01-01'
    const lastYearStart = (parseInt(today.slice(0, 4)) - 1) + '-01-01'
    const lastYearEnd   = (parseInt(today.slice(0, 4)) - 1) + '-12-31'

    const day   = compare(sumPeriod(rows, today, today),         sumPeriod(rows, yesterday, yesterday))
    const week  = compare(sumPeriod(rows, thisWeekStart, today), sumPeriod(rows, lastWeekStart, lastWeekEnd))
    const month = compare(sumPeriod(rows, thisMonthStart, today),sumPeriod(rows, lastMonthStart, lastMonthEnd))
    const year  = compare(sumPeriod(rows, thisYearStart, today), sumPeriod(rows, lastYearStart, lastYearEnd))

    const recent = [...rows].reverse().slice(-30).map(r => ({
      date:          r.date.toISOString().slice(0, 10),
      cardpointe:    Number(r.cardpointe),
      rentalworks:   Number(r.rentalworks),
      ordersCreated: Number(r.orders_created),
      quotesCreated: Number(r.quotes_created),
    }))

    return NextResponse.json({ ok: true, day, week, month, year, recent })
  } catch (err: any) {
    console.error('[collections]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
