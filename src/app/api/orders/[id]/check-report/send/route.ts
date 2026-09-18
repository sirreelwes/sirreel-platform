/**
 * POST /api/orders/[id]/check-report/send — email the check-in report.
 *
 * The button Wes asked for on 2026-09-18: Albert finishes counting an
 * order back in and sends the report, whether everything came back or
 * something is missing. Yard-gated like the sheet itself, and separate
 * from filing on purpose — see lib/orders/sendCheckInReport.ts.
 *
 * Inbound only. There is no outbound equivalent: what left the building
 * already goes to the client as a corrected quote and to the agent as a
 * flag, and the driver's receipt prints from the same screen.
 */

import { NextResponse } from 'next/server'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import { sendCheckInReport } from '@/lib/orders/sendCheckInReport'

export const dynamic = 'force-dynamic'
// One render + one Resend call.
export const maxDuration = 30

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  const result = await sendCheckInReport({
    orderId: id,
    sentById: auth.userId,
    sentByName: auth.name,
  })
  // A send that could not happen is not a server fault — the screen says
  // why (no sheet filed yet, nobody on the channel) and the supervisor
  // can act on it.
  return NextResponse.json(result, { status: result.sent ? 200 : 409 })
}
