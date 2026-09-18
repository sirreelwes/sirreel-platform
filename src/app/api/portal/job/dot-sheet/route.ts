/**
 * GET /api/portal/job/dot-sheet
 *
 * The client's DOT info packet, rendered from the vehicles on their order
 * RIGHT NOW. Cookie-auth'd (JOB_SESSION_COOKIE) like the agreement proxy.
 *
 * TWO THINGS THIS ENFORCES, both of which used to be impossible here because
 * the route only streamed whatever blob was on the Order:
 *
 *  1. FRESHNESS. A van swapped off the order after a rep pressed publish was
 *     still named in the PDF the client downloaded. Nothing is stored on this
 *     path now, so the document cannot disagree with the reservation.
 *  2. THE GATE. `dotSheetState` decides whether the client may have it at
 *     all — a record with blanks is withheld unless a human chose to send it.
 *     The check lives HERE and not only in the payload that draws the link,
 *     because a client who bookmarked this URL would otherwise keep pulling a
 *     sheet the desk believes is being held back.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveJobPortalRead } from '@/lib/portal/jobPreview'
import { dotSheetForOrder, renderDotSheet } from '@/lib/fleet/dotSheet'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const read = await resolveJobPortalRead(req)
  if (!read) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = read.resolved
  if (!resolved) return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })

  const sheet = await dotSheetForOrder(resolved.orderId, [resolved.followedFrom?.id])
  if (!sheet.state.available) {
    return NextResponse.json({ error: 'No DOT sheet available' }, { status: 404 })
  }

  const pdf = await renderDotSheet(sheet)
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="DOT-${resolved.order.orderNumber}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
