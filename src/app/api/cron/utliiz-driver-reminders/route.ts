/** Cron: the evening before a booking's first day, remind the driver once. */
import { NextRequest, NextResponse } from 'next/server'
import { sendDriverReminders } from '@/lib/hq-white-label/driverFlow'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && (req.headers.get('authorization') || '') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, ...(await sendDriverReminders()) })
}
