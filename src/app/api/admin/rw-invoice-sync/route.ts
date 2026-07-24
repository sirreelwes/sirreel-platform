import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { syncRwInvoices } from '@/lib/rentalworks/syncInvoices'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/rw-invoice-sync — refresh the RentalWorks invoice mirror.
 * Authed (staff session) OR CRON_SECRET bearer so it can be scheduled later.
 * GET returns mirror status without touching RW.
 */
export async function GET(req: NextRequest) {
  // Vercel Cron issues GET, so a cron-authorized GET runs the sync;
  // an ordinary staff GET just reports mirror status.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) {
    const result = await syncRwInvoices()
    if (!result.ok) console.error('[rw-invoice-sync cron] failed:', result.error)
    return NextResponse.json({ ...result }, { status: result.ok ? 200 : 502 })
  }
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [count, latest] = await Promise.all([
    prisma.rwInvoice.count(),
    prisma.rwInvoice.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
  ])
  return NextResponse.json({ count, syncedAt: latest?.syncedAt ?? null })
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  const viaCron = !!cronSecret && auth === `Bearer ${cronSecret}`
  if (!viaCron) {
    const session = await getServerSession()
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncRwInvoices()
  if (!result.ok) {
    console.error('[rw-invoice-sync] failed:', result.error)
    return NextResponse.json({ ...result }, { status: 502 })
  }
  return NextResponse.json({ ...result })
}
