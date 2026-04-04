import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const result = await prisma.$executeRaw`
    UPDATE daily_collections SET rentalworks = 20319.90 WHERE rentalworks > 50000
  `
  return NextResponse.json({ updated: result })
}
