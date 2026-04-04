import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function startOfWeek(d: Date) {
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  const mon = new Date(d)
  mon.setDate(d.getDate() + diff)
  mon.setHours(0, 0, 0, 0)
  return mon
}

function toUTCDate(d: Date) {
  return new Date(d.toISOString().slice(0, 10) + 'T00:00:00.000Z')
}

function sumPeriod(rows: any[], from: Date, to: Date) {
  const f = from.getTime(), t = to.getTime()
  const filtered = rows.filter(r => {
    const d = new Date(r.date).getTime()
    return d >= f && d <= t
  })
  return {
    cardpointe:    filtered.reduce((s, r) => s + Number(r.cardpointe), 0),
    rentalworks:   filtered.reduce((s, r) => s + Number(r.rentalworks), 0),
    ordersCreated: filtered.reduce((s, r) => s + Number(r.ordersCreated), 0),
    quotesCreated: filtered.reduce((s, r) => s + Number(r.quotesCreated), 0),
    days: filtered.length,
  }
}

function pct(curr: number, prev: number) {
  if (prev === 0) return curr > 0 ? 100 : 0
  return Math.round(((curr - prev) / prev) * 100)
}

function compare(curr: any, prev: any) {
  const total = (p: any) => p.cardpointe + p.rentalworks
  return {
    curr,
    prev,
    pctCardpointe:  pct(curr.cardpointe, prev.cardpointe),
    pctRentalworks: pct(curr.rentalworks, prev.rentalworks),
    pctTotal:       pct(total(curr), total(prev)),
    pctOrders:      pct(curr.ordersCreated, prev.ordersCreated),
  }
}

export async function GET() {
  try {
    const now = new Date()
    const today = toUTCDate(now)

    // Fetch last 400 days of data
    const since = new Date(today)
    since.setDate(since.getDate() - 400)
    const rows = await prisma.dailyCollections.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'desc' },
    })

    // --- Day ---
    const yesterday = toUTCDate(new Date(today.getTime() - 86400000))
    const day  = compare(sumPeriod(rows, today, today), sumPeriod(rows, yesterday, yesterday))

    // --- Week ---
    const thisWeekStart = toUTCDate(startOfWeek(now))
    const lastWeekStart = toUTCDate(new Date(thisWeekStart.getTime() - 7 * 86400000))
    const lastWeekEnd   = toUTCDate(new Date(thisWeekStart.getTime() - 86400000))
    const week = compare(
      sumPeriod(rows, thisWeekStart, today),
      sumPeriod(rows, lastWeekStart, lastWeekEnd)
    )

    // --- Month ---
    const thisMonthStart = toUTCDate(new Date(now.getFullYear(), now.getMonth(), 1))
    const lastMonthStart = toUTCDate(new Date(now.getFullYear(), now.getMonth() - 1, 1))
    const lastMonthEnd   = toUTCDate(new Date(now.getFullYear(), now.getMonth(), 0))
    const month = compare(
      sumPeriod(rows, thisMonthStart, today),
      sumPeriod(rows, lastMonthStart, lastMonthEnd)
    )

    // --- Year ---
    const thisYearStart = toUTCDate(new Date(now.getFullYear(), 0, 1))
    const lastYearStart = toUTCDate(new Date(now.getFullYear() - 1, 0, 1))
    const lastYearEnd   = toUTCDate(new Date(now.getFullYear() - 1, 11, 31))
    const year = compare(
      sumPeriod(rows, thisYearStart, today),
      sumPeriod(rows, lastYearStart, lastYearEnd)
    )

    // Recent daily rows for sparkline
    const recent = rows.slice(0, 30).reverse().map(r => ({
      date:          r.date,
      cardpointe:    Number(r.cardpointe),
      rentalworks:   Number(r.rentalworks),
      ordersCreated: Number(r.ordersCreated),
      quotesCreated: Number(r.quotesCreated),
    }))

    return NextResponse.json({ ok: true, day, week, month, year, recent })
  } catch (err: any) {
    console.error('[collections]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
