import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const date = new URL(req.url).searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })
  const rows = await prisma.$queryRaw<any[]>`
    SELECT date, cardpointe, rentalworks, orders_created, quotes_created, raw_email
    FROM daily_collections WHERE date = ${new Date(date + 'T12:00:00Z')}
  `
  return NextResponse.json({ rows: rows.map(r => ({ ...r, date: r.date.toISOString().slice(0,10) })) })
}
