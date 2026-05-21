/**
 * Lightweight category list for the scheduling-shadow page. Returns
 * only the fields the dropdown needs.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const categories = await prisma.assetCategory.findMany({
    where: { isPublished: true },
    select: { id: true, name: true, slug: true, totalUnits: true, planyoResourceId: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ ok: true, categories })
}
