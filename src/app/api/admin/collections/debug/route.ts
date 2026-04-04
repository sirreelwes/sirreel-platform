import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const date = new URL(req.url).searchParams.get('date')
  if (!date) {
    // Return all dates to verify storage
    const rows = await prisma.$queryRaw<any[]>`
      SELECT date, cardpointe, rentalworks, raw_email
      FROM daily_collections
      ORDER BY date DESC
    `
    return NextResponse.json({ 
      rows: rows.map(r => ({ 
        date: r.date.toISOString().slice(0,10),
        cardpointe: Number(r.cardpointe),
        rentalworks: Number(r.rentalworks),
        preview: (r.raw_email || '').slice(0, 200)
      }))
    })
  }
  
  const rows = await prisma.$queryRaw<any[]>`
    SELECT date, cardpointe, rentalworks, raw_email
    FROM daily_collections
    WHERE date::text LIKE ${date + '%'}
  `
  return NextResponse.json({ 
    rows: rows.map(r => ({ 
      date: r.date.toISOString().slice(0,10),
      cardpointe: Number(r.cardpointe),
      rentalworks: Number(r.rentalworks),
      raw_email: r.raw_email
    }))
  })
}
