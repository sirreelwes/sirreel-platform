import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/fees — active fee catalog for the order builder's "Add fee"
// picker. Staff-wide (session-gated, not requireAdmin — reps add fees
// to orders). Amounts serialize as strings so money never round-trips
// through a JS float.
export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const fees = await prisma.feeItem.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, code: true, amount: true, unit: true, description: true },
  })
  return NextResponse.json({
    fees: fees.map((f) => ({ ...f, amount: f.amount.toFixed(2) })),
  })
}
